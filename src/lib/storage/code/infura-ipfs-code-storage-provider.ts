import { CodeStorageProvider, FileUploadSpec } from "./code-storage-provider";
import { create, IPFSHTTPClient } from "ipfs-http-client";
import fs from "fs";
import axios from "axios";
import axiosRetry from "axios-retry";

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
    const cids = [];

    for await (const resp of this.#client.addAll(
      files.map((f) => ({
        content: fs.createReadStream(f.path),
      }))
    )) {
      cids.push(resp.cid.toString());
    }

    const urls = await Promise.all(cids.map(this.read));
    await Promise.all(
      urls.map((u) => {
        console.log("fetching", u);
        return axios.get(u, { "axios-retry": { retries: 8 } }).then(() => {
          console.log("fetched", u);
        });
      })
    );

    return cids;
  }

  async read(pointer: string): Promise<string> {
    return `https://ipfs.io/ipfs/${pointer}`;
  }
}
