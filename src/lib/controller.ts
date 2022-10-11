import { CodeStorageProvider } from "./storage/code/code-storage-provider";
import { SourcesDB, ReturnedSource } from "./storage/db/source-db-provider";
import {
  SourceVerifier,
  SourceVerifyPayload,
  CompileResult,
} from "./compiler/source-verifier";
import path from "path";
import { writeFile } from "fs/promises";
import tweetnacl from "tweetnacl";
import { VerifyResult } from "./compiler/source-verifier";
import { Address, beginCell } from "ton";
import BN from "bn.js";
import crypto from "crypto";

export type Base64URL = string;

function sha256(s: string): Buffer {
  return crypto.createHash("sha256").update(s).digest();
}

export class Controller {
  #codeStorageProvider: CodeStorageProvider;
  #sourcesDB: SourcesDB;
  #sourceVerifier: SourceVerifier;
  #keypair: tweetnacl.SignKeyPair;

  constructor(
    codeStorageProvider: CodeStorageProvider,
    sourcesDB: SourcesDB,
    sourceVerifier: SourceVerifier
  ) {
    this.#codeStorageProvider = codeStorageProvider;
    this.#sourcesDB = sourcesDB;
    this.#sourceVerifier = sourceVerifier;
    this.#keypair = tweetnacl.sign.keyPair.fromSecretKey(
      Buffer.from(process.env.PRIVATE_KEY!, "base64")
    );
  }

  async getSource(hash: Base64URL): Promise<ReturnedSource | undefined> {
    // const src = await this.#sourcesDB.get(hash);
    // if (src) {
    //   const sourcesURLs = await Promise.all(
    //     src.sources.map((s) =>
    //       this.#codeStorageProvider.read(s.codeLocationPointer)
    //     )
    //   );
    //   return {
    //     ...src,
    //     sources: src.sources.map((s, i) => ({
    //       url: sourcesURLs[i],
    //       ...s,
    //     })),
    //   };
    // }
    return undefined;
  }

  async addSource(
    verificationPayload: SourceVerifyPayload
  ): Promise<VerifyResult> {
    // const src = await this.#sourcesDB.get(
    //   verificationPayload.knownContractHash
    // );
    // if (src) throw "Already exists";

    const compileResult = await this.#sourceVerifier.verify(
      verificationPayload
    );

    if (
      compileResult.error ||
      compileResult.result !== "similar" ||
      !compileResult.hash
    )
      return {
        compileResult,
      };

    const sourcesToUpload = verificationPayload.sources.map((s) => ({
      path: s.path,
      name: path.basename(s.path),
    }));

    const fileLocators = await this.#codeStorageProvider.write(
      ...sourcesToUpload
    );

    const sourceSpec = {
      compileCommandLine: compileResult.funcCmd,
      compiler: verificationPayload.compiler,
      version: verificationPayload.version,
      hash: compileResult.hash,
      knownContractAddress: verificationPayload.knownContractAddress,
      verificationDate: Date.now(),
      sources: fileLocators.map((f, i) => ({
        url: f,
        filename: sourcesToUpload[i].name,
        hasIncludeDirectives:
          verificationPayload.sources[i].hasIncludeDirectives,
        includeInCompile: verificationPayload.sources[i].includeInCompile,
        isEntrypoint: verificationPayload.sources[i].isEntrypoint,
        isStdLib: verificationPayload.sources[i].isStdLib,
      })),
    };

    const jsonPayload = JSON.stringify(sourceSpec);

    const ipfsLink = await this.#codeStorageProvider.writeFromContent(
      Buffer.from(jsonPayload)
    );

    // await this.#sourcesDB.add();

    const verifier = sha256("orbs3.com");

    const validUntil = Math.floor(Date.now() / 1000) + 60 * 10;

    // This is the message that will be forwarded to verifier registry
    const msgCell = beginCell()
      .storeBuffer(verifier)
      .storeUint(validUntil, 32)
      .storeAddress(Address.parse(verificationPayload.senderAddress))
      .storeAddress(Address.parse(process.env.SOURCES_REGISTRY!))
      .storeRef(
        // BEGIN: message to sources registry
        beginCell()
          .storeUint(0x1, 32)
          .storeUint(0, 64)
          .storeBuffer(verifier)
          .storeUint(new BN(Buffer.from(compileResult.hash!, "base64")), 256)
          .storeRef(
            // BEGIN: source item content cell
            beginCell()
              // TODO support snakes
              .storeBuffer(Buffer.from(ipfsLink[0]))
              .endCell()
          )
          .endCell()
      )
      .endCell();

    const sig = Buffer.from(
      tweetnacl.sign.detached(msgCell.hash(), this.#keypair.secretKey)
    );

    const sigCell = beginCell()
      .storeBuffer(sig)
      .storeBuffer(Buffer.from(this.#keypair.publicKey))
      .endCell();

    return {
      compileResult,
      sig: sig.toString("base64"),
      ipfsLink: ipfsLink[0],
      msgCell: beginCell()
        .storeUint(0x75217758, 32)
        .storeUint(0, 64)
        .storeRef(msgCell)
        .storeRef(sigCell)
        .endCell()
        .toBoc(),
    };
  }
}
