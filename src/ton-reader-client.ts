import { Address, Cell, Dictionary, TonClient } from "ton";
import { DictionaryValue } from "ton-core";
import { toBigIntBE, toBufferBE } from "bigint-buffer";
import { sha256 } from "./utils";
import { getHttpEndpoint } from "@orbs-network/ton-access";
import { ContractVerifier } from "@ton-community/contract-verifier-sdk";
import { VerifierRegistry } from "./wrappers/verifier-registry";
import { SourcesRegistry } from "./wrappers/sources-registry";

export type VerifierConfig = {
  verifiers: Buffer[];
  quorum: number;
};

export interface TonReaderClient {
  isProofDeployed(codeCellHash: string, verifierId: string): Promise<boolean | undefined>;
  getVerifierConfig(verifierId: string, verifierRegistryAddress: string): Promise<VerifierConfig>;
}

export async function getTonClient() {
  const endpoint = await getHttpEndpoint({
    network: process.env.NETWORK === "testnet" ? "testnet" : "mainnet",
  });
  console.log("Using endpoint:" + endpoint);
  return new TonClient({ endpoint });
}

export function createNullValue(): DictionaryValue<null> {
  return {
    serialize: (src, buidler) => {
      buidler;
    },
    parse: (src) => {
      return null;
    },
  };
}

export class TonReaderClientImpl implements TonReaderClient {
  async getVerifierConfig(
    verifierId: string,
    sourcesRegistryAddress: string,
  ): Promise<VerifierConfig> {
    const tc = await getTonClient();

    const sourcesRegistryContract = tc.open(
      SourcesRegistry.createFromAddress(Address.parse(sourcesRegistryAddress)),
    );

    const verifierRegistryAddress = await sourcesRegistryContract.getVerifierRegistryAddress();
    const verifierRegstryContract = tc.open(
      VerifierRegistry.createFromAddress(verifierRegistryAddress),
    );

    const res = await verifierRegstryContract.getVerifier(toBigIntBE(sha256(verifierId)));
    const verifierConfig = res.settings!.beginParse();

    const quorum = verifierConfig.loadUint(8);
    const verifiers = Array.from(
      verifierConfig.loadDict(Dictionary.Keys.BigUint(256), createNullValue()).keys(),
    ).map((k) => toBufferBE(k, 32));

    return {
      verifiers,
      quorum,
    };
  }

  async isProofDeployed(codeCellHash: string, verifierId: string): Promise<boolean | undefined> {
    return !!(await ContractVerifier.getSourcesJsonUrl(codeCellHash, {
      verifier: verifierId,
      testnet: process.env.NETWORK === "testnet",
    }));
  }
}
