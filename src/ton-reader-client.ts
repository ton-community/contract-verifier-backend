import { Address, Dictionary, DictionaryValue } from "@ton/core";
import { toBigIntBE, toBufferBE } from "bigint-buffer";
import { sha256 } from "./utils";
import { LiteClient, LiteRoundRobinEngine, LiteSingleEngine } from "ton-lite-client";
import { VerifierRegistry } from "./wrappers/verifier-registry";
import { SourcesRegistry } from "./wrappers/sources-registry";
import { getLogger } from "./logger";

const logger = getLogger("ton-reader-client");

export type VerifierConfig = {
  verifiers: Buffer[];
  quorum: number;
};

export interface TonReaderClient {
  isProofDeployed(
    codeCellHash: string,
    verifierId: string,
    sourcesRegistryAddress: string,
  ): Promise<boolean | undefined>;
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
    logger.debug("Returning cached TON client");
    return clientPromise;
  }

  try {
    logger.info("Creating new TON client connection");
    clientPromise = createClient();
    return await clientPromise;
  } catch (error) {
    logger.error("Failed to create TON client", { error });
    clientPromise = null;
    throw error;
  }
}

async function createClient(): Promise<LiteClient> {
  const isTestnet = process.env.NETWORK === "testnet";
  const configUrl = isTestnet
    ? "https://ton.org/testnet-global.config.json"
    : "https://ton.org/global.config.json";

  logger.info("Fetching TON config", {
    configUrl,
    network: isTestnet ? "testnet" : "mainnet",
  });

  const response = await fetch(configUrl);
  if (!response.ok) {
    logger.error("Failed to fetch TON config", {
      configUrl,
      status: response.status,
      statusText: response.statusText,
    });
    throw new Error(`Failed to fetch TON config: ${response.status}`);
  }

  const config = await response.json();
  if (!config.liteservers?.length) {
    logger.error("No liteservers in config", { configUrl });
    throw new Error("No liteservers found in config");
  }

  logger.debug("Creating lite engines", {
    liteserversCount: config.liteservers.length,
  });

  const engines: LiteSingleEngine[] = [];

  for (const server of config.liteservers) {
    const engine = new LiteSingleEngine({
      host: `tcp://${intToIP(server.ip)}:${server.port}`,
      publicKey: Buffer.from(server.id.key, "base64"),
    });
    engines.push(engine);
  }

  const engine = new LiteRoundRobinEngine(engines);

  logger.info("TON client created successfully", {
    liteserversCount: config.liteservers.length,
    network: isTestnet ? "testnet" : "mainnet",
  });

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
    logger.debug("Getting verifier config", {
      verifierId,
      sourcesRegistryAddress,
    });

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

    logger.info("Retrieved verifier config", {
      verifierId,
      quorum,
      verifiersCount: verifiers.length,
    });

    return {
      verifiers,
      quorum,
    };
  }

  async isProofDeployed(
    codeCellHash: string,
    verifierId: string,
    sourcesRegistryAddress: string,
  ): Promise<boolean | undefined> {
    logger.debug("Checking if proof deployed", {
      codeCellHash,
      verifierId,
      sourcesRegistryAddress,
    });

    try {
      const tc = await getTonClient();
      const sourcesRegistryContract = tc.open(
        SourcesRegistry.createFromAddress(Address.parse(sourcesRegistryAddress)),
      );

      const sourceItemAddress = await sourcesRegistryContract.getSourceItemAddress(
        verifierId,
        codeCellHash,
      );
      const sourceItemState = await tc.provider(sourceItemAddress).getState();
      const isDeployed = sourceItemState.state.type === "active";

      logger.debug("Proof deployment check result", {
        codeCellHash,
        verifierId,
        isDeployed,
      });

      return isDeployed;
    } catch (error) {
      logger.error("Failed to check proof deployment status", {
        codeCellHash,
        verifierId,
        sourcesRegistryAddress,
        error,
      });

      return undefined;
    }
  }
}
