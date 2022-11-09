import { SourceVerifier, SourceVerifyPayload, SourceToVerify } from "./types";
import path from "path";
import tweetnacl from "tweetnacl";
import { VerifyResult } from "./types";
import { Address, beginCell, Cell } from "ton";
import BN from "bn.js";
import { IpfsCodeStorageProvider } from "./ipfs-code-storage-provider";
import { sha256, random64BitNumber, getNowHourRoundedDown } from "./utils";

export type Base64URL = string;

function deploySource(
  queryId: BN,
  codeCellHash: string,
  ipfsLink: string,
  verifierId: Buffer,
): Cell {
  return beginCell()
    .storeUint(1002, 32) // Deploy source OP
    .storeUint(queryId, 64)
    .storeBuffer(verifierId)
    .storeUint(new BN(Buffer.from(codeCellHash, "base64")), 256)
    .storeRef(
      // Source item content cell
      beginCell().storeUint(1, 8).storeBuffer(Buffer.from(ipfsLink)).endCell(),
    )
    .endCell();
}

function verifierRegistryForwardMessage(
  queryId: BN,
  msgToSign: Cell,
  sigCell: Cell,
): Buffer | undefined {
  return beginCell()
    .storeUint(0x75217758, 32) // Forward message
    .storeUint(queryId, 64)
    .storeRef(msgToSign)
    .storeRef(sigCell)
    .endCell()
    .toBoc();
}

export class Controller {
  #ipfsProvider: IpfsCodeStorageProvider;
  #sourceVerifier: SourceVerifier;
  #keypair: tweetnacl.SignKeyPair;
  #VERIFIER_SHA256: Buffer;

  constructor(ipfsProvider: IpfsCodeStorageProvider, sourceVerifier: SourceVerifier) {
    this.#VERIFIER_SHA256 = sha256(process.env.VERIFIER_ID!);
    this.#ipfsProvider = ipfsProvider;
    this.#sourceVerifier = sourceVerifier;
    this.#keypair = tweetnacl.sign.keyPair.fromSecretKey(
      Buffer.from(process.env.PRIVATE_KEY!, "base64"),
    );
  }

  async addSource(verificationPayload: SourceVerifyPayload): Promise<VerifyResult> {
    // Compile
    const compileResult = await this.#sourceVerifier.verify(verificationPayload);

    if (compileResult.error || compileResult.result !== "similar" || !compileResult.hash) {
      return {
        compileResult,
      };
    }

    // Upload sources to IPFS
    const sourcesToUpload = verificationPayload.sources.map((s: SourceToVerify) => ({
      path: path.join(verificationPayload.tmpDir, s.path),
      name: s.path,
    }));
    const fileLocators = await this.#ipfsProvider.write(...sourcesToUpload);

    const sourceSpec = {
      commandLine: compileResult.funcCmd,
      compiler: verificationPayload.compiler,
      version: verificationPayload.version,
      hash: compileResult.hash,
      verificationDate: getNowHourRoundedDown().getTime(),
      sources: fileLocators.map((f, i) => {
        const src = verificationPayload.sources[i];
        return {
          url: f,
          filename: sourcesToUpload[i].name,
          hasIncludeDirectives: src.hasIncludeDirectives,
          includeInCommand: src.includeInCommand,
          isEntrypoint: src.isEntrypoint,
          isStdLib: src.isStdLib,
        };
      }),
      knownContractAddress: verificationPayload.knownContractAddress,
    };

    // Upload source spec JSON to IPFS
    const [ipfsLink] = await this.#ipfsProvider.writeFromContent(
      Buffer.from(JSON.stringify(sourceSpec)),
    );

    const queryId = random64BitNumber();

    // This is the message that will be forwarded to verifier registry
    const msgToSign = beginCell()
      .storeBuffer(this.#VERIFIER_SHA256)
      .storeUint(Math.floor(Date.now() / 1000) + 60 * 10, 32) // Valid until 10 minutes from now
      .storeAddress(Address.parse(verificationPayload.senderAddress))
      .storeAddress(Address.parse(process.env.SOURCES_REGISTRY!))
      .storeRef(deploySource(queryId, compileResult.hash, ipfsLink, this.#VERIFIER_SHA256))
      .endCell();

    const sig = Buffer.from(tweetnacl.sign.detached(msgToSign.hash(), this.#keypair.secretKey));

    const sigCell = beginCell()
      .storeBuffer(sig)
      .storeBuffer(Buffer.from(this.#keypair.publicKey))
      .endCell();

    return {
      compileResult,
      sig: sig.toString("base64"),
      ipfsLink: ipfsLink,
      msgCell: verifierRegistryForwardMessage(queryId, msgToSign, sigCell),
    };
  }
}
