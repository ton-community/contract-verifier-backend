import { CodeStorageProvider } from "./storage/code/code-storage-provider";
import { SourcesDB, ReturnedSource } from "./storage/db/source-db-provider";
import {
  SourceVerifier,
  SourceVerifyPayload,
  VerifyResult,
} from "./compiler/source-verifier";
import path from "path";

export type Base64URL = string;

export class Controller {
  #codeStorageProvider: CodeStorageProvider;
  #sourcesDB: SourcesDB;
  #sourceVerifier: SourceVerifier;

  constructor(
    codeStorageProvider: CodeStorageProvider,
    sourcesDB: SourcesDB,
    sourceVerifier: SourceVerifier
  ) {
    this.#codeStorageProvider = codeStorageProvider;
    this.#sourcesDB = sourcesDB;
    this.#sourceVerifier = sourceVerifier;
  }

  async getSource(hash: Base64URL): Promise<ReturnedSource | undefined> {
    const src = await this.#sourcesDB.get(hash);
    if (src) {
      const sourcesURLs = await Promise.all(
        src.sources.map((s) =>
          this.#codeStorageProvider.read(s.codeLocationPointer)
        )
      );
      return {
        ...src,
        sources: src.sources.map((s, i) => ({
          url: sourcesURLs[i],
          ...s,
        })),
      };
    }
    return undefined;
  }

  async addSource(
    verificationPayload: SourceVerifyPayload
  ): Promise<VerifyResult> {
    const src = await this.#sourcesDB.get(
      verificationPayload.knownContractHash
    );
    if (src) throw "Already exists";

    const verificationResult = await this.#sourceVerifier.verify(
      verificationPayload
    );

    if (
      verificationResult.error ||
      verificationResult.result !== "similar" ||
      !verificationResult.hash
    )
      return verificationResult;

    const sourcesToUpload = verificationPayload.sources.map((s) => ({
      path: s.path,
      name: path.basename(s.path),
    }));

    const fileLocators = await this.#codeStorageProvider.write(
      ...sourcesToUpload
    );

    await this.#sourcesDB.add({
      compileCommandLine: verificationPayload.compileCommandLine,
      compiler: verificationPayload.compiler,
      version: verificationPayload.version,
      hash: verificationResult.hash,
      knownContractAddress: verificationPayload.knownContractAddress,
      verificationDate: Date.now(),
      sources: fileLocators.map((f, i) => ({
        codeLocationPointer: f,
        originalFilename: sourcesToUpload[i].name,
        hasIncludeDirectives:
          verificationPayload.sources[i].hasIncludeDirectives,
        includeInCompile: verificationPayload.sources[i].includeInCompile,
        isEntrypoint: verificationPayload.sources[i].isEntrypoint,
        isStdLib: verificationPayload.sources[i].isStdLib,
      })),
    });

    return verificationResult;
  }
}
