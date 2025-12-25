import fs from "fs";
// @ts-ignore
import { of } from "ipfs-only-hash";

// This can be a trivial URL, a firebase key, IPFS hash etc.
export type CodeLocationPointer = string;

export type FileUploadSpec = {
  path: string;
  name: string;
};

export interface CodeStorageProvider {
  write(files: FileUploadSpec[], pin: boolean): Promise<CodeLocationPointer[]>;
  writeFromContent(files: Buffer[], pin: boolean): Promise<CodeLocationPointer[]>;
  // Returns URL
  read(pointer: CodeLocationPointer): Promise<string>;
}

type ChainstackUploadResponse = {
  id: string;
  cid: string;
  type: string;
  title: string;
  status: string;
  size: number;
  item_count: number;
  created_at: string;
  updated_at: string;
  bucket_id: string;
  folder_id: string;
  public_link: string;
};

const CHAINSTACK_API_URL = "https://api.chainstack.com/v1/ipfs/pins/pinfile";

export class IpfsCodeStorageProvider implements CodeStorageProvider {
  #apiKey: string;
  #bucketId: string;

  constructor(apiKey: string, bucketId: string) {
    this.#apiKey = apiKey;
    this.#bucketId = bucketId;
  }

  async hashForContent(content: Buffer[]): Promise<string[]> {
    return Promise.all(content.map((c) => of(c)));
  }

  async writeFromContent(files: Buffer[], _pin: boolean): Promise<string[]> {
    return Promise.all(
      files.map(async (content, index) => {
        const formData = new FormData();
        formData.append("bucket_id", this.#bucketId);
        formData.append("file", new Blob([content]), `file-${index}`);

        const response = await fetch(CHAINSTACK_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.#apiKey}`,
          },
          body: formData,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Chainstack upload failed: ${response.status} ${errorText}`);
        }

        const result: ChainstackUploadResponse = await response.json();
        return `ipfs://${result.cid}`;
      }),
    );
  }

  async write(files: FileUploadSpec[], _pin: boolean): Promise<string[]> {
    return Promise.all(
      files.map(async (file) => {
        const content = await fs.promises.readFile(file.path);
        const formData = new FormData();
        formData.append("bucket_id", this.#bucketId);
        formData.append("file", new Blob([content]), file.name);

        const response = await fetch(CHAINSTACK_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.#apiKey}`,
          },
          body: formData,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Chainstack upload failed: ${response.status} ${errorText}`);
        }

        const result: ChainstackUploadResponse = await response.json();
        return `ipfs://${result.cid}`;
      }),
    );
  }

  async read(pointer: string): Promise<string> {
    return (
      await fetch(`https://${process.env.IPFS_PROVIDER}/ipfs/${pointer.replace("ipfs://", "")}`)
    ).text();
  }
}
