import { config } from "dotenv";
import { Address } from "@ton/core";
import { getTonClient } from "../src/ton-reader-client";
import { SourceItem } from "../src/wrappers/source-item";
import { sha256 } from "../src/utils";
import { toBigIntBE } from "bigint-buffer";
import { writeFile, mkdir, access } from "fs/promises";
import * as path from "path";
import { create, IPFSHTTPClient } from "ipfs-http-client";

config({ path: ".env.local" });
config({ path: ".env" });

// Parse command line flags
const args = process.argv.slice(2);
const shouldUpload = args.includes("--upload");
const shouldDownload = !args.includes("--no-download"); // Download by default, unless --no-download is specified

type CIDRecord = {
  sourceItemAddress: string;
  codeCellHash: string;
  ipfsCID: string;
  ipfsLink: string;
  verifierId: string;
  timestamp: number;
  sourceData?: any;
  sourceFileCIDs?: string[]; // CIDs of individual source files
};

type CSVRow = {
  type: "metadata" | "source_file";
  cid: string;
  sourceItemAddress: string;
  codeCellHash: string;
  timestamp: string;
  filename?: string;
  compiler?: string;
};

async function getTransactions(params: {
  address: string;
  limit: number;
  offset: number;
  sort: "asc" | "desc";
  startUtime?: number;
  rpcUrl?: string;
}) {
  // Use custom RPC URL if provided, otherwise fall back to default toncenter
  const rpcUrl =
    params.rpcUrl ||
    (() => {
      const isTestnet = process.env.NETWORK === "testnet";
      return `https://${isTestnet ? "testnet." : ""}toncenter.com/api/v3/actions`;
    })();

  const urlParams: any = {
    account: params.address,
    limit: params.limit.toString(),
    sort: params.sort,
    action_type: "contract_deploy",
  };

  if (params.startUtime) {
    urlParams.start_utime = params.startUtime.toString();
  }

  const url = rpcUrl.includes("?")
    ? `${rpcUrl}&${new URLSearchParams(urlParams)}`
    : `${rpcUrl}?${new URLSearchParams(urlParams)}`;

  console.log(`Fetching transactions from: ${url}`);
  const response = await fetch(url);

  if (response.status !== 200) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const txns = (await response.json()) as { actions: any[] };

  if ("error" in txns) {
    throw new Error(String(txns.error));
  }

  return txns.actions.map((tx: any) => ({
    address: tx.details.destination,
    timestamp: Number(tx.trace_end_utime),
  }));
}

async function fetchAllCIDs(
  verifierId: string,
  ipfsProvider: string,
  sourcesRegistry: string,
  rpcUrl?: string,
  downloadImmediately?: boolean,
): Promise<CIDRecord[]> {
  const verifierIdSha256 = sha256(verifierId);

  console.log(`Starting CID extraction...`);
  console.log(`Verifier ID: ${verifierId}`);
  console.log(`Verifier SHA256: ${verifierIdSha256.toString("hex")}`);
  console.log(`Sources Registry: ${sourcesRegistry}`);
  console.log(`IPFS Provider: ${ipfsProvider}`);
  console.log(`RPC URL: ${rpcUrl || "default (toncenter)"}`);
  console.log("");

  const allRecords: CIDRecord[] = [];
  let offset = 0;
  const limit = 100;
  let hasMore = true;
  let totalFetched = 0;

  const tc = await getTonClient();

  // Create cids directory if downloading immediately
  const cidsDir = downloadImmediately ? path.join(__dirname, "..", "cids") : null;
  if (cidsDir) {
    await mkdir(cidsDir, { recursive: true });
    console.log(`Created/verified cids directory: ${cidsDir}`);
  }

  const processedCIDs = new Set<string>();

  while (hasMore) {
    console.log(`Fetching batch starting at offset ${offset}...`);

    const txns = await getTransactions({
      address: sourcesRegistry,
      limit: limit,
      offset: offset,
      sort: "desc",
      rpcUrl: rpcUrl,
    });

    console.log(`Found ${txns.length} source item deployments`);

    if (txns.length === 0) {
      hasMore = false;
      break;
    }

    // Process each transaction in parallel with concurrency limit
    const processTransaction = async (tx: any) => {
      try {
        const sourceItemContract = tc.open(SourceItem.createFromAddress(Address.parse(tx.address)));

        const { verifierId: contractVerifierId, data } = await sourceItemContract.getData();

        // Skip if not our verifier
        if (contractVerifierId !== toBigIntBE(verifierIdSha256)) {
          console.log(`Skipping ${tx.address} - different verifier`);
          return null;
        }

        if (!data) {
          console.log(`Skipping ${tx.address} - no data`);
          return null;
        }

        // Parse the content cell
        const contentCell = data.beginParse();
        const version = contentCell.loadUint(8);

        if (version !== 1) {
          console.log(`Skipping ${tx.address} - unsupported version ${version}`);
          return null;
        }

        const ipfsLink = contentCell.loadStringTail();
        const cid = ipfsLink.replace("ipfs://", "");

        // Try to fetch metadata from IPFS
        let sourceData = null;
        let sourceFileCIDs: string[] = [];

        try {
          const ipfsUrl = `https://${ipfsProvider}/ipfs/${cid}`;
          console.log(`Fetching metadata from IPFS: ${ipfsUrl}`);
          const response = await fetch(ipfsUrl, {
            signal: AbortSignal.timeout(5000),
          });

          if (response.ok) {
            sourceData = await response.json();

            // Extract CIDs from source files
            if (sourceData?.sources && Array.isArray(sourceData.sources)) {
              for (const source of sourceData.sources) {
                if (source.url) {
                  const sourceCID = source.url.replace("ipfs://", "");
                  sourceFileCIDs.push(sourceCID);
                  console.log(`  → Found source file CID: ${sourceCID} (${source.filename})`);
                }
              }
            }
          } else {
            console.log(`Warning: Could not fetch IPFS data for ${cid} (HTTP ${response.status})`);
          }
        } catch (e) {
          console.log(`Warning: Could not fetch IPFS data for ${cid}: ${e.message}`);
        }

        const record: CIDRecord = {
          sourceItemAddress: tx.address,
          codeCellHash: sourceData?.hash || "unknown",
          ipfsCID: cid,
          ipfsLink: ipfsLink,
          verifierId: verifierId,
          timestamp: tx.timestamp,
          sourceData: sourceData,
          sourceFileCIDs: sourceFileCIDs,
        };

        console.log(`✓ Extracted CID: ${cid} from ${tx.address}`);
        console.log(`  Code hash: ${record.codeCellHash}`);
        console.log(`  Timestamp: ${new Date(tx.timestamp * 1000).toISOString()}`);
        console.log("");

        // Download CIDs immediately if requested
        if (cidsDir && downloadImmediately) {
          // Download metadata CID
          if (!processedCIDs.has(cid)) {
            console.log(`  → Downloading metadata CID: ${cid}`);
            const filePath = await downloadCID(cid, ipfsProvider, cidsDir);
            if (filePath) {
              processedCIDs.add(cid);
              console.log(`  ✓ Downloaded metadata: ${cid}`);
            }
          }

          // Download source file CIDs
          for (const sourceCID of sourceFileCIDs) {
            if (!processedCIDs.has(sourceCID)) {
              console.log(`  → Downloading source CID: ${sourceCID}`);
              const filePath = await downloadCID(sourceCID, ipfsProvider, cidsDir);
              if (filePath) {
                processedCIDs.add(sourceCID);
                console.log(`  ✓ Downloaded source: ${sourceCID}`);
              }
            }
          }
        }

        return record;
      } catch (e) {
        console.error(`Error processing ${tx.address}: ${e.message}`);
        return null;
      }
    };

    // Process transactions in parallel with concurrency limit of 10
    const CONCURRENCY = 10;
    for (let i = 0; i < txns.length; i += CONCURRENCY) {
      const batch = txns.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(processTransaction));

      for (const record of results) {
        if (record) {
          allRecords.push(record);
          totalFetched++;
        }
      }
    }

    offset += limit;

    // Check if we got fewer results than the limit (last page)
    if (txns.length < limit) {
      hasMore = false;
    }

    // Add a small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log(`\nTotal CIDs extracted: ${totalFetched}`);
  return allRecords;
}

function generateCSV(records: CIDRecord[]): string {
  const rows: CSVRow[] = [];

  for (const record of records) {
    const timestampISO = new Date(record.timestamp * 1000).toISOString();

    // Add metadata CID row
    rows.push({
      type: "metadata",
      cid: record.ipfsCID,
      sourceItemAddress: record.sourceItemAddress,
      codeCellHash: record.codeCellHash,
      timestamp: timestampISO,
      compiler: record.sourceData?.compiler || "unknown",
    });

    // Add source file CID rows
    if (record.sourceFileCIDs && record.sourceFileCIDs.length > 0) {
      for (let i = 0; i < record.sourceFileCIDs.length; i++) {
        const sourceCID = record.sourceFileCIDs[i];
        const sourceInfo = record.sourceData?.sources?.[i];

        rows.push({
          type: "source_file",
          cid: sourceCID,
          sourceItemAddress: record.sourceItemAddress,
          codeCellHash: record.codeCellHash,
          timestamp: timestampISO,
          filename: sourceInfo?.filename || "unknown",
          compiler: record.sourceData?.compiler || "unknown",
        });
      }
    }
  }

  // Generate CSV header
  const header = "type,cid,sourceItemAddress,codeCellHash,timestamp,filename,compiler\n";

  // Generate CSV rows
  const csvRows = rows.map((row) => {
    const escapeCsv = (value: string | undefined) => {
      if (!value) return "";
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      if (value.includes(",") || value.includes('"') || value.includes("\n")) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    };

    return [
      escapeCsv(row.type),
      escapeCsv(row.cid),
      escapeCsv(row.sourceItemAddress),
      escapeCsv(row.codeCellHash),
      escapeCsv(row.timestamp),
      escapeCsv(row.filename || ""),
      escapeCsv(row.compiler || ""),
    ].join(",");
  });

  return header + csvRows.join("\n");
}

async function downloadCID(
  cid: string,
  ipfsProvider: string,
  outputDir: string,
): Promise<string | null> {
  // Check if file already exists
  const outputPath = path.join(outputDir, cid);

  try {
    await access(outputPath);
    console.log(`  → File already exists: ${outputPath}`);
    return outputPath;
  } catch {
    // File doesn't exist, proceed with download
  }

  try {
    const ipfsUrl = `https://${ipfsProvider}/ipfs/${cid}`;
    console.log(`  → Downloading from: ${ipfsUrl}`);

    const response = await fetch(ipfsUrl, {
      signal: AbortSignal.timeout(30000), // Increase timeout to 30 seconds
    });

    if (!response.ok) {
      console.log(`  ✗ Failed to download ${cid}: HTTP ${response.status}`);
      return null;
    }

    const content = await response.text();
    console.log(`  → Downloaded ${content.length} bytes for ${cid}`);

    // Ensure directory exists
    await mkdir(outputDir, { recursive: true });

    // Save to disk immediately
    await writeFile(outputPath, content, "utf-8");
    console.log(`  → Wrote file to: ${outputPath}`);

    // Verify file was written to disk
    try {
      await access(outputPath);
      const stats = await import("fs/promises").then((fs) => fs.stat(outputPath));
      console.log(`  ✓ Downloaded and saved ${cid} to ${outputPath} (${stats.size} bytes)`);
    } catch (e) {
      console.log(`  ⚠ Warning: File ${outputPath} was not found after write! Error: ${e.message}`);
      return null;
    }

    return outputPath;
  } catch (e) {
    console.log(`  ✗ Failed to download ${cid}: ${e.message}`);
    return null;
  }
}

async function uploadCID(
  cid: string,
  filePath: string,
  newIpfsClient: IPFSHTTPClient,
): Promise<string | null> {
  try {
    // Read the file from disk
    const { readFile } = await import("fs/promises");
    const fileContent = await readFile(filePath);

    console.log(`  → Read ${filePath} from disk, uploading...`);

    const result = await newIpfsClient.add(fileContent, { pin: true });
    const newCID = result.cid.toString();

    if (newCID !== cid) {
      console.log(`  ⚠ CID mismatch! Original: ${cid}, New: ${newCID}`);
      return null;
    }

    console.log(`  ✓ Uploaded ${cid} to new provider`);
    return newCID;
  } catch (e) {
    console.log(`  ✗ Failed to upload ${cid}: ${e.message}`);
    return null;
  }
}

async function extractCIDsFromFile(filePath: string): Promise<string[]> {
  try {
    const { readFile } = await import("fs/promises");
    const content = await readFile(filePath, "utf-8");
    const data = JSON.parse(content);

    const cids: string[] = [];

    // Extract CIDs from sources array
    if (data?.sources && Array.isArray(data.sources)) {
      for (const source of data.sources) {
        if (source.url) {
          const cid = source.url.replace("ipfs://", "");
          cids.push(cid);
        }
      }
    }

    return cids;
  } catch (e) {
    // File might not be JSON or might not have sources
    return [];
  }
}

async function downloadAndUploadCIDs(
  initialCIDs: Set<string>,
  ipfsProvider: string,
  uploadConfig?: { client: IPFSHTTPClient },
): Promise<{ downloaded: number; uploaded: number; failed: number }> {
  const cidsDir = path.join(__dirname, "..", "cids");
  await mkdir(cidsDir, { recursive: true });

  let downloaded = 0;
  let uploaded = 0;
  let failed = 0;

  console.log(`\n========================================`);
  console.log(`Starting with ${initialCIDs.size} initial CIDs`);
  console.log(`========================================`);

  // Queue of CIDs to process
  const queue: string[] = Array.from(initialCIDs);
  const processed = new Set<string>(); // Track processed CIDs to avoid duplicates
  const processing = new Set<string>(); // Track currently processing CIDs

  let totalDiscovered = initialCIDs.size;

  const processCID = async (cid: string): Promise<{ success: boolean; uploaded: boolean }> => {
    // Skip if already processed or being processed
    if (processed.has(cid) || processing.has(cid)) {
      return { success: true, uploaded: false };
    }

    processing.add(cid);

    try {
      console.log(`[${processed.size + 1}] Processing ${cid}...`);

      // Download and save to disk immediately
      const filePath = await downloadCID(cid, ipfsProvider, cidsDir);
      if (!filePath) {
        processing.delete(cid);
        return { success: false, uploaded: false };
      }

      // Extract more CIDs from the downloaded file and add to queue
      const extractedCIDs = await extractCIDsFromFile(filePath);
      if (extractedCIDs.length > 0) {
        let newCIDs = 0;
        for (const extractedCID of extractedCIDs) {
          if (
            !processed.has(extractedCID) &&
            !processing.has(extractedCID) &&
            !queue.includes(extractedCID)
          ) {
            queue.push(extractedCID);
            newCIDs++;
          }
        }
        if (newCIDs > 0) {
          totalDiscovered += newCIDs;
          console.log(
            `  → Discovered ${newCIDs} new CIDs (total in queue: ${queue.length}, total discovered: ${totalDiscovered})`,
          );
        }
      }

      // Upload if requested - reads from the saved file on disk
      let uploadSuccess = false;
      if (uploadConfig) {
        const uploadResult = await uploadCID(cid, filePath, uploadConfig.client);
        uploadSuccess = uploadResult !== null;
      }

      processed.add(cid);
      processing.delete(cid);

      return { success: true, uploaded: uploadSuccess };
    } catch (e) {
      console.error(`  ✗ Error processing ${cid}: ${e.message}`);
      processing.delete(cid);
      return { success: false, uploaded: false };
    }
  };

  // Process queue with worker pool
  const WORKERS = 20;

  while (queue.length > 0 || processing.size > 0) {
    // Get next batch of CIDs from queue
    const batch: Promise<{ success: boolean; uploaded: boolean }>[] = [];

    while (batch.length < WORKERS && queue.length > 0) {
      const cid = queue.shift()!;
      if (!processed.has(cid) && !processing.has(cid)) {
        batch.push(processCID(cid));
      }
    }

    if (batch.length === 0) {
      // Wait a bit for processing to complete
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }

    // Process batch
    const results = await Promise.all(batch);

    // Aggregate results
    for (const result of results) {
      if (result.success) {
        downloaded++;
        if (result.uploaded) {
          uploaded++;
        } else if (uploadConfig) {
          failed++;
        }
      } else {
        failed++;
      }
    }
  }

  console.log(
    `\n✓ Finished processing. Total discovered: ${totalDiscovered}, Downloaded: ${downloaded}`,
  );

  return { downloaded, uploaded, failed };
}

async function main() {
  const verifierId = process.env.VERIFIER_ID!;
  const ipfsProvider = process.env.IPFS_PROVIDER!;
  const sourcesRegistry = process.env.SOURCES_REGISTRY!;
  const rpcUrl = process.env.RPC_URL; // Optional - will use default if not set

  // New IPFS provider for uploads
  const newInfuraId = process.env.NEW_INFURA_ID;
  const newInfuraSecret = process.env.NEW_INFURA_SECRET;
  const newIpfsUrl = process.env.NEW_IPFS_URL;

  if (!verifierId || !ipfsProvider || !sourcesRegistry) {
    console.error("Error: VERIFIER_ID, IPFS_PROVIDER, and SOURCES_REGISTRY must be set in .env");
    console.error("\nRequired environment variables:");
    console.error("  VERIFIER_ID         - Your verifier ID (e.g., 'orbs.com')");
    console.error("  IPFS_PROVIDER       - IPFS gateway URL (e.g., 'tonsource.infura-ipfs.io')");
    console.error("  SOURCES_REGISTRY    - Sources registry contract address");
    console.error("\nOptional environment variables:");
    console.error("  RPC_URL             - Custom RPC endpoint URL (defaults to toncenter API)");
    console.error("\nFor upload functionality (--upload flag):");
    console.error("  NEW_INFURA_ID       - New Infura project ID");
    console.error("  NEW_INFURA_SECRET   - New Infura project secret");
    console.error("  NEW_IPFS_URL        - New IPFS upload URL (defaults to Infura)");
    console.error("\nFlags:");
    console.error("  --download          - Download CIDs to cids/ folder");
    console.error("  --upload            - Download and upload to new IPFS provider");
    process.exit(1);
  }

  if (shouldUpload && (!newInfuraId || !newInfuraSecret)) {
    console.error("Error: --upload flag requires NEW_INFURA_ID and NEW_INFURA_SECRET");
    process.exit(1);
  }

  console.log("========================================");
  console.log("CID Extraction Script");
  console.log("========================================");
  if (shouldDownload) console.log("Mode: DOWNLOAD");
  if (shouldUpload) console.log("Mode: UPLOAD to new provider");
  console.log("");

  let downloadedCIDsCount = 0;

  try {
    const records = await fetchAllCIDs(
      verifierId,
      ipfsProvider,
      sourcesRegistry,
      rpcUrl,
      shouldDownload,
    );

    // Save to JSON file
    const outputPath = path.join(__dirname, "..", "extracted-cids.json");
    await writeFile(outputPath, JSON.stringify(records, null, 2));
    console.log(`\n✓ Saved ${records.length} CID records to: ${outputPath}`);

    // Save CIDs only (for easy migration)
    const cidsOnlyPath = path.join(__dirname, "..", "cids-only.txt");
    const cidsOnly = records.map((r) => r.ipfsCID).join("\n");
    await writeFile(cidsOnlyPath, cidsOnly);
    console.log(`✓ Saved CIDs list to: ${cidsOnlyPath}`);

    // Save all CIDs (metadata + source files) to CSV
    const csvPath = path.join(__dirname, "..", "all-cids.csv");
    const csv = generateCSV(records);
    await writeFile(csvPath, csv);
    console.log(`✓ Saved all CIDs (metadata + source files) to CSV: ${csvPath}`);

    // Count total unique CIDs
    const allCIDs = new Set<string>();
    records.forEach((r) => {
      allCIDs.add(r.ipfsCID);
      if (r.sourceFileCIDs) {
        r.sourceFileCIDs.forEach((cid) => allCIDs.add(cid));
      }
    });

    // Save unique CIDs list
    const uniqueCIDsPath = path.join(__dirname, "..", "all-unique-cids.txt");
    const uniqueCIDs = Array.from(allCIDs).sort().join("\n");
    await writeFile(uniqueCIDsPath, uniqueCIDs);
    console.log(`✓ Saved ${allCIDs.size} unique CIDs to: ${uniqueCIDsPath}`);

    // Download and optionally upload CIDs - Skipped if already downloaded inline
    let downloadStats = { downloaded: 0, uploaded: 0, failed: 0 };
    if (!shouldDownload && shouldUpload) {
      // Only run if we need to upload but didn't download inline
      let uploadConfig;

      if (shouldUpload) {
        console.log("\nInitializing new IPFS client...");
        const auth = "Basic " + Buffer.from(newInfuraId + ":" + newInfuraSecret).toString("base64");
        const ipfsClient = create({
          url: newIpfsUrl || "https://ipfs.infura.io:5001/api/v0",
          headers: {
            authorization: auth,
          },
        });
        uploadConfig = { client: ipfsClient };
        console.log("✓ IPFS client initialized");
      }

      downloadStats = await downloadAndUploadCIDs(allCIDs, ipfsProvider, uploadConfig);
    } else if (shouldDownload) {
      // Count the downloaded files (if we downloaded inline, they should be in cids/ folder)
      try {
        const { readdir } = await import("fs/promises");
        const cidsDir = path.join(__dirname, "..", "cids");
        const files = await readdir(cidsDir);
        downloadStats.downloaded = files.length;
        console.log(`\n✓ Downloaded ${downloadStats.downloaded} CIDs during extraction`);
      } catch (e) {
        downloadStats.downloaded = allCIDs.size;
        console.log(`\n✓ Processed ${downloadStats.downloaded} unique CIDs`);
      }
    }

    // Print summary
    console.log("\n========================================");
    console.log("Summary");
    console.log("========================================");
    console.log(`Total source items found: ${records.length}`);
    console.log(`Total metadata CIDs: ${records.length}`);
    console.log(
      `Total source file CIDs: ${records.reduce((sum, r) => sum + (r.sourceFileCIDs?.length || 0), 0)}`,
    );
    console.log(`Total unique CIDs (all): ${allCIDs.size}`);
    console.log(`Verifier ID: ${verifierId}`);
    console.log(`Network: ${process.env.NETWORK || "mainnet"}`);

    // Group by compiler if data available
    const byCompiler = records.reduce(
      (acc, r) => {
        const compiler = r.sourceData?.compiler || "unknown";
        acc[compiler] = (acc[compiler] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    console.log("\nBy Compiler:");
    Object.entries(byCompiler).forEach(([compiler, count]) => {
      console.log(`  ${compiler}: ${count}`);
    });

    if (shouldDownload || shouldUpload) {
      console.log("\nDownload/Upload Statistics:");
      console.log(`  Downloaded: ${downloadStats.downloaded}`);
      if (shouldUpload) {
        console.log(`  Uploaded: ${downloadStats.uploaded}`);
      }
      console.log(`  Failed: ${downloadStats.failed}`);
    }

    console.log("\n✓ Done!");
  } catch (error) {
    console.error("\n✗ Error:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
