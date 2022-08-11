import { CodeStorageProvider, FileUploadSpec } from "./code-storage-provider";
import { create, IPFSHTTPClient } from "ipfs-http-client";
import fs from "fs";

export class IpfsCodeStorageProvider implements CodeStorageProvider {
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

  async write(...files: FileUploadSpec[]): Promise<string[]> {
    const cids = await Promise.all(
      files.map((f) =>
        this.#client.add(fs.createReadStream(f.path)).then((r) => {
          console.log("uploaded", f.name);
          return r.cid.toString();
        })
      )
    );

    return cids;
  }

  async read(pointer: string): Promise<string> {
    return `https://tonsource.infura-ipfs.io/ipfs/${pointer}`;
  }
}
