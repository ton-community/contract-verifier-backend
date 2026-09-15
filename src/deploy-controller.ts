import path from "path";
import { CodeStorageProvider } from "./codestorage/provider";
import { FileSystem } from "./source-verifier/tact-source-verifier";
import { PackageFileFormat } from "tact-1.4.1";
import { getLogger } from "./logger";

const logger = getLogger("deploy-controller");

export class DeployController {
  storageProvider: CodeStorageProvider;
  fileSystem: FileSystem;

  constructor(codeStorageProvider: CodeStorageProvider, fileSystem: FileSystem) {
    this.storageProvider = codeStorageProvider;
    this.fileSystem = fileSystem;
  }

  async process({ tmpDir }: { tmpDir: string }) {
    logger.info("Processing Tact deployment", { tmpDir });

    logger.debug("Reading deployment files");
    const files = await this.fileSystem.readdir(tmpDir);
    logger.debug("Files found", { filesCount: files.length, files });

    if (files.length !== 2) {
      logger.error("Invalid file count for deployment", {
        expected: 2,
        actual: files.length,
        files,
      });
      throw new Error("Expecting exactly 1 boc file and 1 pkg file");
    }

    logger.debug("Reading and hashing file contents");
    const fileContents = await Promise.all(
      files.map(async (name) => {
        const content = await this.fileSystem.readFile(path.join(tmpDir, name));
        const [hash] = await this.storageProvider.writeFromContent([content], true);
        return { name, hash, content };
      }),
    );

    const pkgFile = fileContents.find((f) => f.name.endsWith(".pkg"))!.content.toString("utf-8");

    let pkgContents: PackageFileFormat;

    logger.debug("Parsing pkg file");
    try {
      pkgContents = JSON.parse(pkgFile);
      logger.debug("Pkg file parsed successfully");
    } catch (e) {
      logger.error("Failed to parse pkg file", { error: e.message });
      throw new Error("Unable to parse pkg file");
    }

    logger.info("Uploading deployment to storage");
    const [rootHash] = await this.storageProvider.writeFromContent(
      [
        JSON.stringify({
          pkg: fileContents.find((f) => f.name.endsWith(".pkg"))!.hash,
          dataCell: fileContents.find((f) => f.name.endsWith(".boc"))!.hash,
        }),
        ...fileContents.map(({ content }) => content),
      ],
      true,
    );

    logger.debug("Uploading ABI to storage");
    await this.storageProvider.writeFromContent([pkgContents.abi], true);

    const deploymentUrl = `https://verifier.ton.org/tactDeployer/${rootHash.replace("ipfs://", "")}${
      process.env.NETWORK === "testnet" ? "?testnet" : ""
    }`;

    logger.info("Deployment processed successfully", {
      rootHash,
      deploymentUrl,
      network: process.env.NETWORK,
    });

    return deploymentUrl;
  }
}
