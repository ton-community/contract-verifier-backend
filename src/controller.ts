import { SourceVerifier, SourceVerifyPayload, SourceToVerify } from "./types";
import path from "path";
import tweetnacl from "tweetnacl";
import { VerifyResult } from "./types";
import { Address, beginCell } from "ton";
import BN from "bn.js";
import crypto from "crypto";
import { IpfsCodeStorageProvider } from "./ipfs-code-storage-provider";

export type Base64URL = string;

function sha256(s: string): Buffer {
  return crypto.createHash("sha256").update(s).digest();
}

function random64BitNumber() {
  const randomBool = () => (Math.random() > 0.5 ? 1 : 0);
  const random64BitNumber = Array.from({ length: 64 }, randomBool).join("");
  return new BN(random64BitNumber, 2);
}

export class Controller {
  #codeStorageProvider: IpfsCodeStorageProvider;
  #sourceVerifier: SourceVerifier;
  #keypair: tweetnacl.SignKeyPair;

  constructor(
    codeStorageProvider: IpfsCodeStorageProvider,
    sourceVerifier: SourceVerifier
  ) {
    this.#codeStorageProvider = codeStorageProvider;
    this.#sourceVerifier = sourceVerifier;
    this.#keypair = tweetnacl.sign.keyPair.fromSecretKey(
      Buffer.from(process.env.PRIVATE_KEY!, "base64")
    );
  }

  async addSource(
    verificationPayload: SourceVerifyPayload
  ): Promise<VerifyResult> {
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

    const sourcesToUpload = verificationPayload.sources.map(
      (s: SourceToVerify) => ({
        path: path.join(verificationPayload.tmpDir, s.path),
        name: s.path,
      })
    );

    const fileLocators = await this.#codeStorageProvider.write(
      ...sourcesToUpload
    );

    // Strip down to latest hour to avoid spamming IPFS in case of multiple uploads
    const verificationDate = new Date();
    verificationDate.setMinutes(0);
    verificationDate.setSeconds(0);
    verificationDate.setMilliseconds(0);

    const sourceSpec = {
      commandLine: compileResult.funcCmd,
      compiler: verificationPayload.compiler,
      version: verificationPayload.version,
      hash: compileResult.hash,
      verificationDate: verificationDate.getTime(),
      sources: fileLocators.map((f, i) => ({
        url: f,
        filename: sourcesToUpload[i].name,
        hasIncludeDirectives:
          verificationPayload.sources[i].hasIncludeDirectives,
        includeInCommand: verificationPayload.sources[i].includeInCommand,
        isEntrypoint: verificationPayload.sources[i].isEntrypoint,
        isStdLib: verificationPayload.sources[i].isStdLib,
      })),
      knownContractAddress: verificationPayload.knownContractAddress,
    };

    const jsonPayload = JSON.stringify(sourceSpec);

    const ipfsLink = await this.#codeStorageProvider.writeFromContent(
      Buffer.from(jsonPayload)
    );

    console.log(ipfsLink);

    const verifier = sha256("orbs.com");

    const validUntil = Math.floor(Date.now() / 1000) + 60 * 10;

    const queryId = random64BitNumber();

    // This is the message that will be forwarded to verifier registry
    const msgCell = beginCell()
      .storeBuffer(verifier)
      .storeUint(validUntil, 32)
      .storeAddress(Address.parse(verificationPayload.senderAddress))
      .storeAddress(Address.parse(process.env.SOURCES_REGISTRY!))
      .storeRef(
        // BEGIN: message to sources registry
        beginCell()
          .storeUint(1002, 32) // Deploy source
          .storeUint(queryId, 64)
          .storeBuffer(verifier)
          .storeUint(new BN(Buffer.from(compileResult.hash!, "base64")), 256)
          .storeRef(
            // BEGIN: source item content cell
            beginCell()
              .storeUint(1, 8)
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
        .storeUint(queryId, 64)
        .storeRef(msgCell)
        .storeRef(sigCell)
        .endCell()
        .toBoc(),
    };
  }
}
