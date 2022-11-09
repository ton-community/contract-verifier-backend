import { create, IPFSHTTPClient } from "ipfs-http-client";
import fs from "fs";
import { ToContent } from "ipfs-core-types/src/utils";

// This can be a trivial URL, a firebase key, IPFS hash etc.
export type CodeLocationPointer = string;

export type FileUploadSpec = {
  path: string;
  name: string;
};

export interface CodeStorageProvider {
  write(...files: FileUploadSpec[]): Promise<CodeLocationPointer[]>;
  writeFromContent(...files: Buffer[]): Promise<CodeLocationPointer[]>;
  // Returns URL
  read(pointer: CodeLocationPointer): Promise<string>;
}

export class IpfsCodeStorageProvider implements CodeStorageProvider {
  #client: IPFSHTTPClient;

  constructor() {
    const auth =
      "Basic " +
      Buffer.from(process.env.INFURA_ID + ":" + process.env.INFURA_SECRET).toString("base64");

    this.#client = create({
      url: "https://ipfs.infura.io:5001/api/v0",
      headers: {
        authorization: auth,
      },
    });
  }

  writeFromContent(...files: ToContent[]): Promise<string[]> {
    return Promise.all(
      files.map((f) =>
        this.#client.add({ content: f }).then((r) => {
          return `ipfs://${r.cid.toString()}`;
        }),
      ),
    );
  }

  async write(...files: FileUploadSpec[]): Promise<string[]> {
    return this.writeFromContent(...files.map((f) => fs.createReadStream(f.path)));
  }

  async read(pointer: string): Promise<string> {
    return `https://tonsource.infura-ipfs.io/ipfs/${pointer}`;
  }
}
