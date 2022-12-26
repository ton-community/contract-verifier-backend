import {
  SourceVerifier,
  SourceVerifyPayload,
  FiftSourceCompileResult,
  FuncSourceCompileResult,
  TactSourceCompileResult,
} from "./types";
import path from "path";
import tweetnacl from "tweetnacl";
import { VerifyResult, Compiler } from "./types";
import { Address, beginCell, Cell, TonClient } from "ton";
import BN from "bn.js";
import { CodeStorageProvider } from "./ipfs-code-storage-provider";
import { sha256, random64BitNumber, getNowHourRoundedDown } from "./utils";
import { TonReaderClient } from "./is-proof-deployed";

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

interface ControllerConfig {
  verifierId: string;
  privateKey: string;
  sourcesRegistryAddress: string;
  allowReverification: boolean;
}

export class Controller {
  #ipfsProvider: CodeStorageProvider;
  #keypair: tweetnacl.SignKeyPair;
  #VERIFIER_SHA256: Buffer;
  config: ControllerConfig;
  compilers: { [key in Compiler]: SourceVerifier };
  tonReaderClient: TonReaderClient;

  constructor(
    ipfsProvider: CodeStorageProvider,
    compilers: { [key in Compiler]: SourceVerifier },
    config: ControllerConfig,
    tonReaderClient: TonReaderClient,
  ) {
    this.#VERIFIER_SHA256 = sha256(config.verifierId);
    this.config = config;
    this.compilers = compilers;
    this.#ipfsProvider = ipfsProvider;
    this.#keypair = tweetnacl.sign.keyPair.fromSecretKey(
      Buffer.from(this.config.privateKey, "base64"),
    );
    this.tonReaderClient = tonReaderClient;
  }

  async addSource(verificationPayload: SourceVerifyPayload): Promise<VerifyResult> {
    // Compile
    const compiler = this.compilers[verificationPayload.compiler];
    const compileResult = await compiler.verify(verificationPayload);
    if (compileResult.error || compileResult.result !== "similar" || !compileResult.hash) {
      return {
        compileResult,
      };
    }

    if (!this.config.allowReverification) {
      const isDeployed = await this.tonReaderClient.isProofDeployed(
        verificationPayload.knownContractHash,
        this.config.sourcesRegistryAddress,
        this.config.verifierId,
      );
      if (isDeployed) {
        return {
          compileResult: {
            result: "unknown_error",
            error: "Contract is already deployed",
            hash: null,
            compilerSettings: compileResult.compilerSettings,
            sources: compileResult.sources,
          },
        };
      }
    }

    // Upload sources to IPFS
    const sourcesToUpload = compileResult.sources.map(
      (s: FuncSourceCompileResult | FiftSourceCompileResult | TactSourceCompileResult) => ({
        path: path.join(verificationPayload.tmpDir, s.filename),
        name: s.filename,
      }),
    );
    const fileLocators = await this.#ipfsProvider.write(...sourcesToUpload);

    const sourceSpec = {
      compilerSettings: compileResult.compilerSettings,
      compiler: verificationPayload.compiler,
      hash: compileResult.hash,
      verificationDate: getNowHourRoundedDown().getTime(),
      sources: fileLocators.map((f, i) => {
        return {
          url: f,
          ...compileResult.sources[i],
        };
      }),
      knownContractAddress: verificationPayload.knownContractAddress,
    };

    // Upload source spec JSON to IPFS
    const [ipfsLink] = await this.#ipfsProvider.writeFromContent(
      Buffer.from(JSON.stringify(sourceSpec)),
    );

    console.log(ipfsLink);

    const queryId = random64BitNumber();

    // This is the message that will be forwarded to verifier registry
    const msgToSign = this.cellToSign(
      verificationPayload.senderAddress,
      queryId,
      compileResult.hash!,
      ipfsLink,
      this.config.sourcesRegistryAddress,
    );

    const { sig, sigCell } = this.signatureCell(msgToSign);

    return {
      compileResult,
      sig: sig.toString("base64"),
      ipfsLink: ipfsLink,
      msgCell: verifierRegistryForwardMessage(queryId, msgToSign, sigCell),
    };
  }

  public async sign({ messageCell }: { messageCell: Buffer }) {
    throw new Error("Not implemented");
  }

  private signatureCell(msgToSign: Cell) {
    const sig = Buffer.from(tweetnacl.sign.detached(msgToSign.hash(), this.#keypair.secretKey));

    const sigCell = beginCell()
      .storeBuffer(sig)
      .storeBuffer(Buffer.from(this.#keypair.publicKey))
      .endCell();
    return { sig, sigCell };
  }

  private cellToSign(
    senderAddress: string,
    queryId: BN,
    codeCellHash: string,
    ipfsLink: string,
    sourcesRegistry: string,
  ) {
    return beginCell()
      .storeBuffer(this.#VERIFIER_SHA256)
      .storeUint(Math.floor(Date.now() / 1000) + 60 * 10, 32) // Valid until 10 minutes from now
      .storeAddress(Address.parse(senderAddress))
      .storeAddress(Address.parse(sourcesRegistry))
      .storeRef(deploySource(queryId, codeCellHash, ipfsLink, this.#VERIFIER_SHA256))
      .endCell();
  }
}
