import { CodeStorageProvider } from "./provider";
import { Infura } from "./infura";
import { Pinata } from "./pinata";
import { getLogger } from "../logger";

const logger = getLogger("codestorage");

export function createCodeStorageProvider(
  providerType: string | undefined,
  infuraId?: string,
  infuraSecret?: string,
  pinataJwt?: string,
  pinataGateway?: string,
): CodeStorageProvider {
  const provider = (providerType || "infura").toLowerCase();

  if (provider === "pinata") {
    if (!pinataJwt) {
      throw new Error("PINATA_JWT is required when IPFS_STORAGE_PROVIDER=pinata");
    }
    logger.info("Using Pinata for IPFS storage");
    return new Pinata(pinataJwt, pinataGateway);
  }

  // Default to Infura
  if (!infuraId || !infuraSecret) {
    throw new Error("INFURA_ID and INFURA_SECRET are required when using Infura storage");
  }
  logger.info("Using Infura for IPFS storage");
  return new Infura(infuraId, infuraSecret);
}
