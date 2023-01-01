import { Address, Cell, TonClient } from "ton";
import BN from "bn.js";
import { sha256 } from "./utils";
import { getHttpEndpoint } from "@orbs-network/ton-gateway";

export type VerifierConfig = {
  verifiers: Buffer[];
  quorum: number;
};

export interface TonReaderClient {
  isProofDeployed(
    codeCellHash: string,
    sourcesRegistryAddress: string,
    verifierId: string,
  ): Promise<boolean | undefined>;

  getVerifierConfig(verifierId: string, verifierRegistryAddress: string): Promise<VerifierConfig>;
}

// TODO - copied from contract-verifier-sdk
// when npm installation is figured out correctly there, this can be eliminated
export class TonReaderClientImpl implements TonReaderClient {
  private async getTonClient() {
    const endpoint = await getHttpEndpoint();
    console.log("Using endpoint:" + endpoint);
    return new TonClient({ endpoint });
  }

  async getVerifierConfig(
    verifierId: string,
    verifierRegistryAddress: string,
  ): Promise<VerifierConfig> {
    const tc = await this.getTonClient();
    const res = await tc.callGetMethod(Address.parse(verifierRegistryAddress), "get_verifier", [
      ["num", new BN(sha256(verifierId)).toString()],
    ]);

    const verifierConfig = Cell.fromBoc(
      Buffer.from(res.stack[1][1].bytes, "base64"),
    )[0].beginParse();

    const quorum = verifierConfig.readUint(8).toNumber();
    const verifiers = Array.from(verifierConfig.readDict(256, (pkE) => null).keys()).map((k) =>
      new BN(k).toBuffer(),
    );

    return {
      verifiers,
      quorum,
    };
  }

  async isProofDeployed(
    codeCellHash: string,
    sourcesRegistryAddress: string,
    verifierId: string,
  ): Promise<boolean | undefined> {
    const tc = await this.getTonClient();
    const { stack: sourceItemAddressStack } = await tc.callGetMethod(
      Address.parse(sourcesRegistryAddress),
      "get_source_item_address",
      [
        ["num", new BN(sha256(verifierId)).toString()],
        ["num", new BN(Buffer.from(codeCellHash, "base64")).toString(10)],
      ],
    );

    const sourceItemAddr = Cell.fromBoc(
      Buffer.from(sourceItemAddressStack[0][1].bytes, "base64"),
    )[0]
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

      return !!ipfsLink;
    }
  }
}
