import dotenv from "dotenv";
import { Address } from "ton";
import axios from "axios";
import async from "async";
import { sha256 } from "./utils";
import { getTonClient } from "./ton-reader-client";
import { toBigIntBE } from "bigint-buffer";
import { SourceItem } from "./wrappers/source-item";
import { getLogger } from "./logger";

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

async function update(verifierIdSha256: Buffer, ipfsProvider: string) {
  // TODO - this means that clients get empty responses quickly instead of waiting
  // for the single-instance fetch. needsfix
  // @ts-ignore
  if (lastUpdateTime && new Date() - lastUpdateTime < 10 * 60 * 1000) {
    return;
  }

  lastUpdateTime = new Date();
  const tc = await getTonClient();
  const limit = 500;
  const address = process.env.SOURCES_REGISTRY!;

  try {
    const txn = await axios.get(
      `https://${
        process.env.NETWORK === "testnet" ? "testnet." : ""
      }toncenter.com/api/index/getTransactionsByAddress?address=${address}&limit=${limit}&offset=0&sort=desc&include_msg_body=false`,
    );

    const potentialDestinations = new Set<string>(
      txn.data.map((t: any) => t.out_msgs?.[0]?.destination).filter((o?: string) => o),
    );

    const results = await async.mapLimit(
      Array.from(potentialDestinations),
      25,
      async function (dest: string, callback) {
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
      },
    );

    // @ts-ignore
    contracts.unshift(...results.filter((o: any) => o));
  } catch (e) {
    logger.error(e);
    lastUpdateTime = null;
  }
}

export async function getLatestVerified(verifierId: string, ipfsProvider: string) {
  const verifierIdSha256 = sha256(verifierId);
  await update(verifierIdSha256, ipfsProvider);
  return contracts;
}
