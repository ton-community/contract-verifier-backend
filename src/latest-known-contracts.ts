import dotenv from "dotenv";
import { Address, Cell, TonClient } from "ton";
import { getHttpEndpoint } from "@orbs-network/ton-gateway";
import axios from "axios";
import BN from "bn.js";
import async from "async";
import { sha256 } from "./utils";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const sourceItemKnownContract: Record<string, boolean> = {};
const contracts: {
  address: string;
  mainFile: string;
  compiler: string;
}[] = [];
let lastUpdateTime: null | Date = null;

async function update(verifierIdSha256: Buffer, ipfsProvider: string) {
  // @ts-ignore
  if (lastUpdateTime && new Date() - lastUpdateTime < 10 * 60 * 1000) {
    return;
  }

  lastUpdateTime = new Date();
  const ep = await getHttpEndpoint();
  const tc = new TonClient({ endpoint: ep });
  const limit = 500;
  const address = process.env.SOURCES_REGISTRY!;

  const txn = await axios.get(
    `https://toncenter.com/api/index/getTransactionsByAddress?address=${address}&limit=${limit}&offset=0&sort=desc&include_msg_body=false`,
  );

  const potentialDestinations = new Set<string>(
    txn.data.map((t: any) => t.out_msgs?.[0]?.destination).filter((o?: string) => o),
  );

  try {
    const results = await async.mapLimit(
      Array.from(potentialDestinations),
      25,
      async function (dest: string, callback) {
        if (sourceItemKnownContract[dest]) {
          callback(null, null);
          return;
        }

        try {
          const { stack: sourceItemDataStack } = await tc.callGetMethod(
            Address.parse(dest),
            "get_source_item_data",
          );

          const verifierId = new BN(sourceItemDataStack[0][1].replace("0x", ""), "hex");

          if (!verifierId.toBuffer().equals(verifierIdSha256)) {
            callback();
            return;
          }

          const contentCell = Cell.fromBoc(
            Buffer.from(sourceItemDataStack[3][1].bytes, "base64"),
          )[0].beginParse();

          const version = contentCell.readUintNumber(8);
          if (version !== 1) throw new Error("Unsupported version");
          const ipfsLink = contentCell.readRemainingBytes().toString();

          const ipfsData = await axios.get(
            `https://${ipfsProvider}/ipfs/${ipfsLink.replace("ipfs://", "")}`,
            { timeout: 1000 },
          );

          const mainFilename = ipfsData.data.sources
            ?.filter((o: any) => o?.type !== "abi")
            .reverse()?.[0]?.filename;
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
          console.warn(e);
          callback(null);
        }
      },
    );

    // @ts-ignore
    contracts.push(...results.filter((o: any) => o));
  } catch (e) {
    console.warn(e);
    lastUpdateTime = null;
  }
}

export async function getLatestVerified(verifierId: string, ipfsProvider: string) {
  const verifierIdSha256 = sha256(verifierId);
  await update(verifierIdSha256, ipfsProvider);
  return contracts;
}
