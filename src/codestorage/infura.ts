import { create, IPFSHTTPClient } from "ipfs-http-client";
import fs from "fs";
// @ts-ignore
import { of } from "ipfs-only-hash";
import { CodeStorageProvider, FileUploadSpec } from "./provider";
import { ToContent } from "ipfs-core-types/src/utils";
import { getLogger } from "../logger";

const logger = getLogger("infura");

export class Infura implements CodeStorageProvider {
  #client: IPFSHTTPClient;

  constructor(infuraId: string, infuraSecret: string) {
    const auth = "Basic " + Buffer.from(infuraId + ":" + infuraSecret).toString("base64");

    this.#client = create({
      url: "https://ipfs.infura.io:5001/api/v0",
      headers: {
        authorization: auth,
      },
    });
  }

  async hashForContent(content: ToContent[]): Promise<string[]> {
    return Promise.all(content.map((c) => of(c)));
  }

  async writeFromContent(files: ToContent[], pin: boolean): Promise<string[]> {
    logger.debug("Writing content to IPFS", { filesCount: files.length, pin });
    const startTime = Date.now();

    const results = await Promise.all(
      files.map((f, index) =>
        this.#client.add({ content: f }, { pin }).then((r) => {
          const cid = `ipfs://${r.cid.toString()}`;
          logger.debug("File uploaded to IPFS", { index, cid });
          return cid;
        }),
      ),
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
    return this.writeFromContent(
      files.map((f) => fs.createReadStream(f.path)),
      pin,
    );
  }

  async read(pointer: string): Promise<string> {
    logger.debug("Reading from IPFS", { pointer });
    const startTime = Date.now();

    const url = `https://${process.env.IPFS_PROVIDER}/ipfs/${pointer.replace("ipfs://", "")}`;
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
