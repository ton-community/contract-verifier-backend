import { CodeStorageProvider, FileUploadSpec } from "./code-storage-provider";
import { create, IPFSHTTPClient } from "ipfs-http-client";

class IpfsCodeStorageProvider implements CodeStorageProvider {
  #client: IPFSHTTPClient;

  constructor() {
    const auth =
      "Basic " +
      Buffer.from(
        process.env.INFURA_ID + ":" + process.env.INFURA_SECRET
      ).toString("base64");

    this.#client = create({
      url: "https://ipfs.infura.io:5001/api/v0",
      headers: {
        authorization: auth,
      },
    });
  }

  async write(...files: FileUploadSpec[]): Promise<string[]> {}
  async read(pointer: string): Promise<string> {
    return `https://ipfs.io/ipfs/${pointer}`;
  }
}
