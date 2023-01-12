import { Address, Cell, TonClient } from "ton";
import BN from "bn.js";
import { sha256 } from "./utils";
import { getHttpEndpoint } from "@orbs-network/ton-gateway";
import { ContractVerifier } from "@ton-community/contract-verifier-sdk";

export type VerifierConfig = {
  verifiers: Buffer[];
  quorum: number;
};

export interface TonReaderClient {
  isProofDeployed(codeCellHash: string, verifierId: string): Promise<boolean | undefined>;

  getVerifierConfig(verifierId: string, verifierRegistryAddress: string): Promise<VerifierConfig>;
}

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

  async isProofDeployed(codeCellHash: string, verifierId: string): Promise<boolean | undefined> {
    return !!(await ContractVerifier.getSourcesJsonUrl(codeCellHash, { verifier: verifierId }));
  }
}
