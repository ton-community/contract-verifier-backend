import { Address, Dictionary, DictionaryValue } from "@ton/core";
import { toBigIntBE, toBufferBE } from "bigint-buffer";
import { sha256 } from "./utils";
import { LiteClient, LiteRoundRobinEngine, LiteSingleEngine } from "ton-lite-client";
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

function intToIP(int: number) {
  const part1 = int & 255;
  const part2 = (int >> 8) & 255;
  const part3 = (int >> 16) & 255;
  const part4 = (int >> 24) & 255;

  return part4 + "." + part3 + "." + part2 + "." + part1;
}

let clientPromise: Promise<LiteClient> | null = null;

export async function getTonClient(): Promise<LiteClient> {
  if (clientPromise) {
    return clientPromise;
  }

  try {
    clientPromise = createClient();
    return await clientPromise;
  } catch (error) {
    clientPromise = null;
    throw error;
  }
}

async function createClient(): Promise<LiteClient> {
  const isTestnet = process.env.NETWORK === "testnet";
  const configUrl =
    process.env.LITESERVER_CONFIG_URL ??
    (isTestnet
      ? "https://ton.org/testnet-global.config.json"
      : "https://ton.org/global.config.json");

  console.log("Using config URL:" + configUrl);

  const response = await fetch(configUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch TON config: ${response.status}`);
  }

  const config = await response.json();
  if (!config.liteservers?.length) {
    throw new Error("No liteservers found in config");
  }

  const engines: LiteSingleEngine[] = [];

  for (const server of config.liteservers) {
    const engine = new LiteSingleEngine({
      host: `tcp://${intToIP(server.ip)}:${server.port}`,
      publicKey: Buffer.from(server.id.key, "base64"),
    });
    engines.push(engine);
  }

  const engine = new LiteRoundRobinEngine(engines);
  return new LiteClient({ engine });
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
    const verifierRegistryContract = tc.open(
      VerifierRegistry.createFromAddress(verifierRegistryAddress),
    );

    const res = await verifierRegistryContract.getVerifier(toBigIntBE(sha256(verifierId)));
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
