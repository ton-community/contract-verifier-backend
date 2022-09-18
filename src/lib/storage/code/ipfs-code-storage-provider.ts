import { CodeStorageProvider, FileUploadSpec } from "./code-storage-provider";
import { create, IPFSHTTPClient } from "ipfs-http-client";
import fs from "fs";

import dotenv from "dotenv";
import { Readable } from "stream";
dotenv.config();

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
  
  writeFromContent(...files: Buffer[]): Promise<string[]> {
    return Promise.all(
      files.map((f) =>
        this.#client.add({ content: f }).then((r) => {
          return r.cid.toString();
        })
      )
    );
  }

  async write(...files: FileUploadSpec[]): Promise<string[]> {
    return Promise.all(
      files.map((f) =>
        this.#client.add({ content: fs.createReadStream(f.path) }).then((r) => {
          console.log("uploaded", f.name);
          return r.cid.toString();
        })
      )
    );
  }

  async read(pointer: string): Promise<string> {
    return `https://tonsource.infura-ipfs.io/ipfs/${pointer}`;
  }
}
