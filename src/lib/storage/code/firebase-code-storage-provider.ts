import admin from "firebase-admin";
import { Bucket } from "@google-cloud/storage";
import { upload } from "gcs-resumable-upload";
import fs from "fs";
import fsPromises from "fs/promises";
// @ts-ignore
import { of as ipfsOnlyHash } from "ipfs-only-hash";

import {
  CodeLocationPointer,
  CodeStorageProvider,
  FileUploadSpec,
} from "./code-storage-provider";

type FirebaseCodeStorageProviderOpts = {
  bucketName: string;
  keyFile: string;
};
export class FirebaseCodeStorageProvider implements CodeStorageProvider {
  #app: admin.app.App;
  #bucket: Bucket;
  #opts: FirebaseCodeStorageProviderOpts;

  constructor(
    firebaseApp: admin.app.App,
    storageOpts: FirebaseCodeStorageProviderOpts
  ) {
    this.#app = firebaseApp;
    this.#bucket = this.#app.storage().bucket(storageOpts.bucketName);
    this.#opts = storageOpts;
  }

  // TODO: consider whether generating would-be IPFS hash as name is desirable
  // For migration purposes
  async write(...files: FileUploadSpec[]): Promise<CodeLocationPointer[]> {
    const hashPromises = files.map(({ path }) =>
      fsPromises.readFile(path).then(ipfsOnlyHash)
    );

    const allHashes = await Promise.all(hashPromises);

    const uploadPromises = files.map(({ path, name }, i) => {
      return new Promise<CodeLocationPointer>((resolve, reject) => {
        const uploadReq = upload({
          bucket: this.#bucket.name,
          // @ts-ignore
          file: allHashes[i] as string,
          // TODO it is ugly that app is authenticated and we provide this again. figure out how to merge
          authConfig: { keyFile: this.#opts.keyFile },
          // generation: 0, // TODO more readable way of not allowing overwrites
        });

        fs.createReadStream(path)
          // @ts-ignore
          .pipe(uploadReq)
          // .on("progress", (progress: any) => {
          //   console.log("Progress event:");
          //   console.log("\t bytes: ", progress.bytesWritten);
          // })
          .on("error", reject)
          .on("finish", () => {
            // @ts-ignore
            resolve(allHashes[i] as string);
          });
      });
    });
    return Promise.all(uploadPromises);
  }
  async read(pointer: string): Promise<string> {
    return (
      "https://" +
      this.#bucket.name +
      ".storage.googleapis.com/" +
      this.#bucket.file(pointer).name
    );
  }
}

// (async () => {
//   const x = await this.#bucket.setCorsConfiguration([
//     {
//       origin: ["*"],
//       method: ["GET"],
//       responseHeader: ["*"]
//     },
//   ]);
//   console.log(x[0].cors)
// })();
