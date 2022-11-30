import { Address, Cell, TonClient } from "ton";
import BN from "bn.js";
import { sha256 } from "./utils";
import { getHttpEndpoint } from "@orbs-network/ton-gateway";

// TODO - copoied from contract-verifier-sdk
// when npm installation is figured out correctly there, this can be eliminated
export async function isProofDeployed(codeCellHash: string) {
  const endpoint = await getHttpEndpoint();
  const tc = new TonClient({ endpoint });
  const { stack: sourceItemAddressStack } = await tc.callGetMethod(
    Address.parse(process.env.SOURCES_REGISTRY!),
    "get_source_item_address",
    [
      ["num", new BN(sha256(process.env.VERIFIER_ID!)).toString()],
      ["num", new BN(Buffer.from(codeCellHash, "base64")).toString(10)],
    ],
  );

  const sourceItemAddr = Cell.fromBoc(Buffer.from(sourceItemAddressStack[0][1].bytes, "base64"))[0]
    .beginParse()
    .readAddress()!;

  const isDeployed = await tc.isContractDeployed(sourceItemAddr);

  if (isDeployed) {
    const { stack: sourceItemDataStack } = await tc.callGetMethod(
      sourceItemAddr,
      "get_source_item_data",
    );
    const contentCell = Cell.fromBoc(
      Buffer.from(sourceItemDataStack[3][1].bytes, "base64"),
    )[0].beginParse();
    const version = contentCell.readUintNumber(8);
    if (version !== 1) throw new Error("Unsupported version");
    const ipfsLink = contentCell.readRemainingBytes().toString();

    return ipfsLink;
  }
}
