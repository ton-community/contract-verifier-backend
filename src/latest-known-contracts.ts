import dotenv from "dotenv";
import { Address } from "@ton/core";
import axios from "axios";
import async from "async";
import { getTonClient } from "./ton-reader-client";
import { SourceItem } from "./wrappers/source-item";
import { getLogger } from "./logger";
import { IndexStorageProvider } from "./indexstorage/provider";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const logger = getLogger("latest-known-contracts");

const isTestnet = process.env.NETWORK === "testnet";
const cacheKey = isTestnet ? "cacheTestnet" : "cache";
const lockKey = cacheKey + `_LOCK`;
const ipfsTimeout = parseInt(process.env.IPFS_TIMEOUT || "15000", 10);
const ipfsFetchParallelism = parseInt(process.env.IPFS_FETCH_PARALLELISM || "2", 10);
const pollInterval = parseInt(process.env.POLL_INTERVAL || "300000", 10);
const batchSize = parseInt(process.env.BATCH_SIZE || "25", 10);
const lockDuration = parseInt(process.env.LOCK_DURATION || "600000", 10);

type TonTransactionsArchiveProviderParams = {
  address: string;
  limit: number;
  offset: number;
  sort: "asc" | "desc";
  startUtime: number | null;
};

async function getTransactions(params: TonTransactionsArchiveProviderParams) {
  const urlParams: any = {
    account: params.address,
    limit: params.limit.toString(),
    sort: params.sort,
    action_type: "contract_deploy",
  };

  if (params.startUtime) {
    urlParams.start_utime = params.startUtime.toString();
  }

  const url =
    `https://${isTestnet ? "testnet." : ""}toncenter.com/api/v3/actions?` +
    new URLSearchParams(urlParams);

  const response = await fetch(url);

  if (response.status !== 200) {
    throw new Error(response.statusText);
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

async function update(storage: IndexStorageProvider, ipfsProvider: string) {
  logger.debug(`Updating latest verified`);
  let lockAcquired = false;
  try {
    const txnResult = await storage.setWithTxn<{ timestamp: number }>(lockKey, (lock) => {
      if (lock && Date.now() - lock.timestamp < lockDuration) {
        logger.debug(`Lock acquired by another instance`);
        return;
      }

      return { timestamp: Date.now() };
    });

    lockAcquired = txnResult.committed;

    if (!lockAcquired) return;

    let lastTimestamp =
      (await storage.readItems<{ timestamp: number }>(cacheKey, 1))?.[0]?.timestamp ?? null;

    if (lastTimestamp) lastTimestamp += 1;

    logger.debug(`Got latest timestamp: ${lastTimestamp}`);

    const txns = await getTransactions({
      address: process.env.SOURCES_REGISTRY!,
      limit: batchSize,
      offset: 0,
      sort: "asc",
      startUtime: lastTimestamp,
    });

    logger.debug(`Got ${txns.length} transactions`);

    const tc = await getTonClient();

    const res = await async.mapLimit(txns, ipfsFetchParallelism, async (obj: any) => {
      logger.debug("Processing transaction", {
        address: obj.address,
        timestamp: obj.timestamp,
      });

      try {
        logger.debug("Fetching source item data", { address: obj.address });
        const sourceItemContract = tc.open(
          SourceItem.createFromAddress(Address.parse(obj.address)),
        );
        const { verifierId, data } = await sourceItemContract.getData();

        const contentCell = data!.beginParse();

        const version = contentCell.loadUint(8);
        if (version !== 1) throw new Error("Unsupported version");
        const ipfsLink = contentCell.loadStringTail();

        logger.debug("Fetching from IPFS", {
          url: ipfsLink,
          address: obj.address,
        });

        let ipfsData;
        let url = `https://${ipfsProvider}/ipfs/${ipfsLink.replace("ipfs://", "")}`;
        const ipfsFetchStart = Date.now();
        try {
          ipfsData = (await axios.get(url, { timeout: ipfsTimeout })).data;
          logger.debug("IPFS fetch successful", {
            address: obj.address,
            ipfsLink,
            duration: Date.now() - ipfsFetchStart,
            dataSize: ipfsData ? JSON.stringify(ipfsData) : 0,
          });
        } catch (e) {
          const error = e instanceof Error ? e : new Error(String(e));
          logger.warn("IPFS fetch failed", {
            url,
            ipfsLink,
            address: obj.address,
            error: error.message,
            duration: Date.now() - ipfsFetchStart,
          });
          throw new Error(`Unable to fetch IPFS cid: ${ipfsLink} using ${url}`, {
            cause: error,
          });
        }

        const mainFilename = ipfsData.sources?.sort((a: any, b: any) => {
          if (a.type && b.type) {
            return Number(b.type === "code") - Number(a.type === "code");
          }
          return Number(b.isEntrypoint) - Number(a.isEntrypoint);
        })?.[0]?.filename;

        const nameParts = Array.from(mainFilename.matchAll(/(?:\/|^)([^\/\n]+)/g)).map(
          // @ts-ignore
          (m) => m[1],
        );

        const result = {
          address: ipfsData.knownContractAddress,
          mainFile: nameParts[nameParts.length - 1],
          compiler: ipfsData.compiler,
          timestamp: obj.timestamp,
          verifierId: verifierId.toString(16),
        };

        logger.info("Successfully processed contract", {
          address: obj.address.toString(),
          compiler: result.compiler,
          mainFile: result.mainFile,
          verifierId: result.verifierId,
        });

        return result;
      } catch (e) {
        logger.warn("Failed to process contract", {
          address: obj.address.toString(),
          error: e.message,
          timestamp: obj.timestamp,
        });
        return;
      }
    });

    const totalResults = res.length;
    const successResults = res.filter((o) => !!o).length;
    logger.debug(`Successfully processed ${successResults} of ${totalResults} addresses`);

    for (const r of res.filter((o) => !!o)) {
      await storage.addForDescendingOrder(cacheKey, r);
    }
  } catch (e) {
    logger.error(e);
  } finally {
    try {
      if (lockAcquired) {
        await storage.remove(lockKey);
      }
    } catch (e) {
      logger.warn(e);
    }
  }
}

export function pollLatestVerified(storage: IndexStorageProvider, ipfsProvider: string) {
  void update(storage, ipfsProvider);

  setInterval(async () => {
    try {
      await update(storage, ipfsProvider);
    } catch (e) {
      logger.warn(`Unable to fetch latest verified ${e}`);
    }
  }, pollInterval);
}

export async function getLatestVerified(storage: IndexStorageProvider) {
  return storage.readItems(cacheKey, 500);
}
