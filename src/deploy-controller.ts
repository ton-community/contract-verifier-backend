import path from "path";
import { IpfsCodeStorageProvider } from "./ipfs-code-storage-provider";
import { FileSystem } from "./source-verifier/tact-source-verifier";
import { PackageFileFormat } from "@tact-lang/compiler";

export class DeployController {
  storageProvider: IpfsCodeStorageProvider;
  fileSystem: FileSystem;

  constructor(codeStorageProvider: IpfsCodeStorageProvider, fileSystem: FileSystem) {
    this.storageProvider = codeStorageProvider;
    this.fileSystem = fileSystem;
  }

  async process({ tmpDir }: { tmpDir: string }) {
    const files = await this.fileSystem.readdir(tmpDir);

    console.log(files);

    if (files.length !== 2) throw new Error("Expecting exactly 2 files");

    const fileContents = await Promise.all(
      files.map(async (name) => {
        const content = await this.fileSystem.readFile(path.join(tmpDir, name));
        const [hash] = await this.storageProvider.hashForContent([content]);
        return { name, hash, content };
      }),
    );

    const pkgFile = fileContents.find((f) => f.name.endsWith(".pkg"))!.content.toString("utf-8");
    const pkgContents: PackageFileFormat = JSON.parse(pkgFile);

    const [rootHash] = await this.storageProvider.writeFromContent(
      [
        JSON.stringify({
          pkg: fileContents.find((f) => f.name.endsWith(".pkg"))!.hash,
          dataCell: fileContents.find((f) => f.name.endsWith(".boc"))!.hash,
        }),
        ...fileContents.map(({ content }) => content),
      ],
      false,
    );

    await this.storageProvider.writeFromContent([pkgContents.abi], true);

    return `https://verifier.ton.org/tactDeployer/${rootHash.replace("ipfs://", "")}`;
  }
}
