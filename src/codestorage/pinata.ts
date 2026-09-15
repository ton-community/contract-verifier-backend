import fs from "fs";
import path from "path";
import { ToContent } from "ipfs-core-types/src/utils";
// @ts-ignore
import { of } from "ipfs-only-hash";
import { Readable } from "stream";
import { PinataSDK } from "pinata";
import { CodeStorageProvider, FileUploadSpec } from "./provider";
import { getLogger } from "../logger";

const logger = getLogger("pinata");

export class Pinata implements CodeStorageProvider {
  #pinata: PinataSDK;
  #gateway: string;

  constructor(jwt: string, gateway?: string) {
    this.#pinata = new PinataSDK({ pinataJwt: jwt });
    this.#gateway = gateway || "gateway.pinata.cloud";
  }

  async hashForContent(content: ToContent[]): Promise<string[]> {
    return Promise.all(content.map((c) => of(c)));
  }

  async writeFromContent(files: ToContent[], pin: boolean): Promise<string[]> {
    logger.debug("Writing content to IPFS", { filesCount: files.length, pin });
    const startTime = Date.now();

    const results = await Promise.all(
      files.map(async (f, index) => {
        // Convert ToContent to a File-like object that Pinata SDK can handle
        let fileData: Buffer;
        if (Buffer.isBuffer(f)) {
          fileData = f;
        } else if (f instanceof Readable) {
          // Read stream into buffer
          const chunks: Buffer[] = [];
          for await (const chunk of f) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          fileData = Buffer.concat(chunks);
        } else {
          // Convert other types to buffer
          fileData = Buffer.from(f.toString());
        }

        // Create a File from the buffer
        const file = new File([fileData], "file");
        const result = await this.#pinata.upload.public.file(file);
        const cid = `ipfs://${result.cid}`;
        logger.debug("File uploaded to IPFS", { index, cid });
        return cid;
      }),
    );

    logger.info("Content written to IPFS successfully", {
      filesCount: results.length,
      duration: Date.now() - startTime,
    });

    return results;
  }

  async write(files: FileUploadSpec[], pin: boolean): Promise<string[]> {
    logger.debug("Writing files to IPFS", {
      filesCount: files.length,
      pin,
      files: files.map((f) => f.name),
    });
    const startTime = Date.now();

    const results = await Promise.all(
      files.map(async (fileSpec, index) => {
        // Read the file from the filesystem
        const fileData = await fs.promises.readFile(fileSpec.path);
        const file = new File([fileData], path.basename(fileSpec.name));
        const result = await this.#pinata.upload.public.file(file);
        const cid = `ipfs://${result.cid}`;
        logger.debug("File uploaded to IPFS", { index, fileName: fileSpec.name, cid });
        return cid;
      }),
    );

    logger.info("Files written to IPFS successfully", {
      filesCount: results.length,
      duration: Date.now() - startTime,
    });

    return results;
  }

  async read(pointer: string): Promise<string> {
    logger.debug("Reading from IPFS", { pointer });
    const startTime = Date.now();

    const hash = pointer.replace("ipfs://", "");
    const url = `https://${this.#gateway}/ipfs/${hash}`;
    const response = await fetch(url);

    if (!response.ok) {
      logger.error("Failed to read from IPFS", {
        pointer,
        url,
        status: response.status,
        statusText: response.statusText,
      });
      throw new Error(`IPFS read failed: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    logger.debug("Successfully read from IPFS", {
      pointer,
      duration: Date.now() - startTime,
      size: text.length,
    });

    return text;
  }
}
