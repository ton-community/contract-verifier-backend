import dotenv from "dotenv";
import { Address } from "@ton/core";
import axios from "axios";
import async from "async";
import { sha256 } from "./utils";
import { getTonClient } from "./ton-reader-client";
import { toBigIntBE } from "bigint-buffer";
import { SourceItem } from "./wrappers/source-item";
import { getLogger } from "./logger";
import { firebaseProvider } from "./firebase-provider";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const logger = getLogger("latest-known-contracts");

const isTestnet = process.env.NETWORK === "testnet";
const cacheKey = isTestnet ? "cacheTestnet" : "cache";
const lockKey = cacheKey + `_LOCK`;

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

async function update(verifierIdSha256: Buffer, ipfsProvider: string) {
  logger.debug(`Updating latest verified`);
  let lockAcquired = false;
  try {
    const txnResult = await firebaseProvider.setWithTxn<{ timestamp: number }>(lockKey, (lock) => {
      if (lock && Date.now() - lock.timestamp < 40_000) {
        logger.debug(`Lock acquired by another instance`);
        return;
      }

      return { timestamp: Date.now() };
    });

    lockAcquired = txnResult.committed;

    if (!lockAcquired) return;

    let lastTimestamp =
      (await firebaseProvider.readItems<{ timestamp: number }>(cacheKey, 1))?.[0]?.timestamp ??
      null;

    if (lastTimestamp) lastTimestamp += 1;

    logger.debug(`Got latest timestamp: ${lastTimestamp}`);

    const txns = await getTransactions({
      address: process.env.SOURCES_REGISTRY!,
      limit: 100,
      offset: 0,
      sort: "asc",
      startUtime: lastTimestamp,
    });

    const tc = await getTonClient();

    const res = await async.mapLimit(txns, 10, async (obj: any) => {
      try {
        const sourceItemContract = tc.open(
          SourceItem.createFromAddress(Address.parse(obj.address)),
        );
        const { verifierId, data } = await sourceItemContract.getData();

        // Not our verifier id, ignore
        if (verifierId !== toBigIntBE(verifierIdSha256)) {
          return;
        }

        const contentCell = data!.beginParse();

        const version = contentCell.loadUint(8);
        if (version !== 1) throw new Error("Unsupported version");
        const ipfsLink = contentCell.loadStringTail();

        let ipfsData;
        try {
          ipfsData = await axios.get(
            `https://${ipfsProvider}/ipfs/${ipfsLink.replace("ipfs://", "")}`,
            { timeout: 3000 },
          );
        } catch (e) {
          throw new Error("Unable to fetch IPFS cid: " + ipfsLink);
        }

        const mainFilename = ipfsData.data.sources?.sort((a: any, b: any) => {
          if (a.type && b.type) {
            return Number(b.type === "code") - Number(a.type === "code");
          }
          return Number(b.isEntrypoint) - Number(a.isEntrypoint);
        })?.[0]?.filename;

        const nameParts = Array.from(mainFilename.matchAll(/(?:\/|^)([^\/\n]+)/g)).map(
          // @ts-ignore
          (m) => m[1],
        );

        return {
          address: ipfsData.data.knownContractAddress,
          mainFile: nameParts[nameParts.length - 1],
          compiler: ipfsData.data.compiler,
          timestamp: obj.timestamp,
        };
      } catch (e) {
        logger.warn(e);
        return;
      }
    });

    logger.debug(res.length);
    logger.debug(res.filter((o) => !!o).length);

    for (const r of res.filter((o) => !!o)) {
      await firebaseProvider.addForDescendingOrder(cacheKey, r);
    }
  } catch (e) {
    logger.error(e);
  } finally {
    try {
      if (lockAcquired) {
        await firebaseProvider.remove(lockKey);
      }
    } catch (e) {
      logger.warn(e);
    }
  }
}

export function pollLatestVerified(verifierId: string, ipfsProvider: string) {
  void update(sha256(verifierId), ipfsProvider);

  setInterval(async () => {
    try {
      await update(sha256(verifierId), ipfsProvider);
    } catch (e) {
      logger.warn(`Unable to fetch latest verified ${e}`);
    }
  }, 60_000);
}

export async function getLatestVerified() {
  return firebaseProvider.readItems(cacheKey, 500);
}
