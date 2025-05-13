import dotenv from "dotenv";
import { Address } from "ton";
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

const sourceItemKnownContract: Record<string, boolean> = {};
const contracts: {
  address: string;
  mainFile: string;
  compiler: string;
}[] = [];
let lastUpdateTime: null | Date = null;

const logger = getLogger("latest-known-contracts");

type TonTransactionsArchiveProviderParams = {
  address: string;
  limit: number;
  offset: number;
  sort: "asc" | "desc";
  startUtime: number;
};

async function getTransactions(params: TonTransactionsArchiveProviderParams) {
  const response = await fetch(
    `https://${
      process.env.NETWORK === "testnet" ? "testnet." : ""
    }toncenter.com/api/index/getTransactionsByAddress?` +
      new URLSearchParams({
        address: params.address,
        limit: params.limit.toString(),
        sort: params.sort,
        include_msg_body: "false",
        start_utime: params.startUtime.toString(),
      }),
  );

  const txns = (await response.json()) as any[];

  return txns
    .filter((tx) => tx.out_msgs.length === 1)
    .map((tx: any) => ({
      address: tx.out_msgs[0].destination as string,
      timestamp: Number(tx.utime),
    }));
}

async function update(verifierIdSha256: Buffer, ipfsProvider: string) {
  try {
    const lastTimestamp = await firebaseProvider.get<number>("cacheTimestamp");

    const txns = await getTransactions({
      address: process.env.SOURCES_REGISTRY!,
      limit: 100,
      offset: 0,
      sort: "asc",
      startUtime: lastTimestamp ?? 0,
    });

    const tc = await getTonClient();

    const results = await async.mapLimit(txns, 10, async function (dest: string, callback) {
      if (sourceItemKnownContract[dest]) {
        callback(null, null);
        return;
      }

      try {
        const sourceItemContract = tc.open(SourceItem.createFromAddress(Address.parse(dest)));
        const { verifierId, data } = await sourceItemContract.getData();

        if (verifierId !== toBigIntBE(verifierIdSha256)) {
          callback();
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

        sourceItemKnownContract[dest] = true;
        callback(null, {
          address: ipfsData.data.knownContractAddress,
          mainFile: nameParts[nameParts.length - 1],
          compiler: ipfsData.data.compiler,
        });
      } catch (e) {
        logger.error(e);
        callback(null);
      }
    });

    // @ts-ignore
    contracts.unshift(...results.filter((o: any) => o));
  } catch (e) {
    logger.error(e);
    lastUpdateTime = null;
  }
}

export async function getLatestVerified(verifierId: string, ipfsProvider: string) {
  await firebaseProvider.addForDescendingOrder("cache", {
    ipfs: "123" + Date.now(),
  });
  console.log(await firebaseProvider.readItems("cache"));
  // const verifierIdSha256 = sha256(verifierId);
  // await update(verifierIdSha256, ipfsProvider);
  // return contracts;
}
