import { readdir, readFile, writeFile } from "fs/promises";
import * as path from "path";

// Chainstack configuration - set these environment variables before running
import dotenv from "dotenv";
dotenv.config({ path: ".env" });
const CHAINSTACK_API_KEY = process.env.CHAINSTACK_API_KEY || "";
const CHAINSTACK_BUCKET_ID = process.env.CHAINSTACK_BUCKET_ID || "";
const CHAINSTACK_API_URL = "https://api.chainstack.com/v1/ipfs/pins/pinfile";

type UploadResult = {
  filename: string;
  originalCID: string;
  newCID: string;
  size: number;
  status: "success" | "failed" | "mismatch";
  error?: string;
};

type ChainstackUploadResponse = {
  cid: string;
  size: number;
};

async function uploadFilesToIPFS(directoryPath: string): Promise<UploadResult[]> {
  if (!CHAINSTACK_API_KEY || !CHAINSTACK_BUCKET_ID) {
    throw new Error(
      "CHAINSTACK_API_KEY and CHAINSTACK_BUCKET_ID environment variables must be set",
    );
  }

  console.log("========================================");
  console.log("IPFS Upload Script (Chainstack)");
  console.log("========================================");
  console.log(`Directory: ${directoryPath}`);
  console.log(`Bucket ID: ${CHAINSTACK_BUCKET_ID}`);
  console.log("");

  // Read all files in the directory
  const files = await readdir(directoryPath);
  console.log(`Found ${files.length} files to upload\n`);

  const results: UploadResult[] = [];
  let successCount = 0;
  let failedCount = 0;
  let mismatchCount = 0;

  // Process files with concurrency control
  const CONCURRENCY = 10;

  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);

    const batchResults = await Promise.all(
      batch.map(async (filename) => {
        const filePath = path.join(directoryPath, filename);

        try {
          console.log(
            `[${i + batch.indexOf(filename) + 1}/${files.length}] Uploading ${filename}...`,
          );

          // Read file content
          const fileContent = await readFile(filePath);

          // Upload to Chainstack IPFS
          const formData = new FormData();
          formData.append("bucket_id", CHAINSTACK_BUCKET_ID);
          formData.append("file", new Blob([new Uint8Array(fileContent)]), filename);

          const response = await fetch(CHAINSTACK_API_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${CHAINSTACK_API_KEY}`,
            },
            body: formData,
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
          }

          const result: ChainstackUploadResponse = await response.json();
          const newCID = result.cid;

          // Check if CID matches filename (assuming filename is the original CID)
          const status = newCID === filename ? "success" : "mismatch";

          if (status === "success") {
            console.log(`  ✓ Uploaded successfully: ${newCID}`);
            successCount++;
          } else {
            console.log(`  ⚠ CID mismatch! Expected: ${filename}, Got: ${newCID}`);
            mismatchCount++;
          }

          return {
            filename,
            originalCID: filename,
            newCID,
            size: fileContent.length,
            status,
          } as UploadResult;
        } catch (error: any) {
          console.log(`  ✗ Failed to upload ${filename}: ${error.message}`);
          failedCount++;

          return {
            filename,
            originalCID: filename,
            newCID: "",
            size: 0,
            status: "failed",
            error: error.message,
          } as UploadResult;
        }
      }),
    );

    results.push(...batchResults);

    // Small delay between batches to avoid rate limiting
    if (i + CONCURRENCY < files.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  console.log("\n========================================");
  console.log("Upload Summary");
  console.log("========================================");
  console.log(`Total files: ${files.length}`);
  console.log(`Successful uploads: ${successCount}`);
  console.log(`Failed uploads: ${failedCount}`);
  console.log(`CID mismatches: ${mismatchCount}`);
  console.log("");

  return results;
}

async function main() {
  const cidsDir = path.join(__dirname, "..", "cids");

  try {
    const results = await uploadFilesToIPFS(cidsDir);

    // Save results to JSON file
    const outputPath = path.join(__dirname, "..", "upload-results.json");
    await writeFile(outputPath, JSON.stringify(results, null, 2));
    console.log(`✓ Upload results saved to: ${outputPath}`);

    // Save successful CIDs to text file
    const successfulCIDs = results
      .filter((r) => r.status === "success")
      .map((r) => r.newCID)
      .join("\n");

    const successPath = path.join(__dirname, "..", "uploaded-cids.txt");
    await writeFile(successPath, successfulCIDs);
    console.log(`✓ Successful uploads list saved to: ${successPath}`);

    // Save failed uploads if any
    const failed = results.filter((r) => r.status === "failed");
    if (failed.length > 0) {
      const failedPath = path.join(__dirname, "..", "failed-uploads.json");
      await writeFile(failedPath, JSON.stringify(failed, null, 2));
      console.log(`⚠ Failed uploads saved to: ${failedPath}`);
    }

    // Save mismatches if any
    const mismatches = results.filter((r) => r.status === "mismatch");
    if (mismatches.length > 0) {
      const mismatchPath = path.join(__dirname, "..", "cid-mismatches.json");
      await writeFile(mismatchPath, JSON.stringify(mismatches, null, 2));
      console.log(`⚠ CID mismatches saved to: ${mismatchPath}`);
    }

    console.log("\n✓ Done!");
  } catch (error: any) {
    console.error("\n✗ Error:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
