import { create, IPFSHTTPClient } from "ipfs-http-client";
import fs from "fs";
import { ToContent } from "ipfs-core-types/src/utils";
// @ts-ignore
import { of } from "ipfs-only-hash";

// This can be a trivial URL, a firebase key, IPFS hash etc.
export type CodeLocationPointer = string;

export type FileUploadSpec = {
  path: string;
  name: string;
};
export type IpfsAuth =
  | {
    type: "basic";
    username: string;
    password: string;
  }
  | { type: "custom"; token: "string" };

export interface CodeStorageProvider {
  write(files: FileUploadSpec[], pin: boolean): Promise<CodeLocationPointer[]>;
  writeFromContent(files: Buffer[], pin: boolean): Promise<CodeLocationPointer[]>;
  // Returns URL
  read(pointer: CodeLocationPointer): Promise<string>;
}

export class IpfsCodeStorageProvider implements CodeStorageProvider {
  #client: IPFSHTTPClient;

  constructor(credentials?: IpfsAuth) {
    const headers = new Headers();

    if (credentials) {
      const auth =
        credentials.type == "basic"
          ? "Basic " +
          Buffer.from(credentials.username + ":" + credentials.password).toString("base64")
          : credentials.token;
      headers.set("Authorization", auth);
    }
    const url = new URL(process.env.IPFS_API!);

    this.#client = create({
      url: url.toString(),
      headers: Object.fromEntries(headers.entries()),
    });
  }

  async hashForContent(content: ToContent[]): Promise<string[]> {
    return Promise.all(content.map((c) => of(c)));
  }

  async writeFromContent(files: ToContent[], pin: boolean): Promise<string[]> {
    return Promise.all(
      files.map((f) =>
        this.#client.add({ content: f }, { pin }).then((r) => {
          return `ipfs://${r.cid.toString()}`;
        }),
      ),
    );
  }

  async write(files: FileUploadSpec[], pin: boolean): Promise<string[]> {
    return this.writeFromContent(
      files.map((f) => fs.createReadStream(f.path)),
      pin,
    );
  }

  async read(pointer: string): Promise<string> {
    return (
      await fetch(`${process.env.IPFS_PROVIDER}/ipfs/${pointer.replace("ipfs://", "")}`)
    ).text();
  }
}
