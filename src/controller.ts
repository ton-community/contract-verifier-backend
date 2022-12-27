import {
  SourceVerifier,
  SourceVerifyPayload,
  FiftSourceCompileResult,
  FuncSourceCompileResult,
  TactSourceCompileResult,
} from "./types";
import path from "path";
import tweetnacl from "tweetnacl";
import {
  VerifyResult,
  Compiler,
  FuncCliCompileSettings,
  FiftCliCompileSettings,
  TactCliCompileSettings,
  SourceItem,
} from "./types";
import { Address, beginCell, Cell, TonClient } from "ton";
import BN from "bn.js";
import { CodeStorageProvider } from "./ipfs-code-storage-provider";
import { sha256, random64BitNumber, getNowHourRoundedDown } from "./utils";
import { TonReaderClient } from "./ton-reader-client";
import { validateMessageCell } from "./validateMessageCell";
import { SourceToVerify } from "./types";

export type Base64URL = string;

export const DEPLOY_SOURCE_OP = 1002;

function deploySource(
  queryId: BN,
  codeCellHash: string,
  ipfsLink: string,
  verifierId: Buffer,
): Cell {
  return beginCell()
    .storeUint(DEPLOY_SOURCE_OP, 32)
    .storeUint(queryId, 64)
    .storeBuffer(verifierId)
    .storeUint(new BN(Buffer.from(codeCellHash, "base64")), 256)
    .storeRef(
      // Source item content cell
      beginCell().storeUint(1, 8).storeBuffer(Buffer.from(ipfsLink)).endCell(),
    )
    .endCell();
}

export const FORWARD_MESSAGE_OP = 0x75217758;

function verifierRegistryForwardMessage(
  queryId: BN,
  msgToSign: Cell,
  sigCell: Cell,
): Buffer | undefined {
  return beginCell()
    .storeUint(FORWARD_MESSAGE_OP, 32) // Forward message
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
  verifierRegistryAddress: string;
}

export class Controller {
  private ipfsProvider: CodeStorageProvider;
  private keypair: tweetnacl.SignKeyPair;
  private VERIFIER_SHA256: Buffer;
  private config: ControllerConfig;
  private compilers: { [key in Compiler]: SourceVerifier };
  private tonReaderClient: TonReaderClient;

  constructor(
    ipfsProvider: CodeStorageProvider,
    compilers: { [key in Compiler]: SourceVerifier },
    config: ControllerConfig,
    tonReaderClient: TonReaderClient,
  ) {
    this.VERIFIER_SHA256 = sha256(config.verifierId);
    this.config = config;
    this.compilers = compilers;
    this.ipfsProvider = ipfsProvider;
    this.keypair = tweetnacl.sign.keyPair.fromSecretKey(
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
    const fileLocators = await this.ipfsProvider.write(...sourcesToUpload);

    const sourceSpec: SourceItem = {
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
    const [ipfsLink] = await this.ipfsProvider.writeFromContent(
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
    const cell = Cell.fromBoc(messageCell)[0];

    const verifierConfig = await this.tonReaderClient.getVerifierConfig(
      this.config.verifierId,
      this.config.verifierRegistryAddress,
    );

    const { ipfsPointer, codeCellHash, senderAddress, date, queryId } = validateMessageCell(
      cell,
      this.VERIFIER_SHA256,
      this.config.sourcesRegistryAddress,
      this.keypair,
      verifierConfig,
    );

    const json: SourceItem = JSON.parse(await this.ipfsProvider.read(ipfsPointer));

    if (json.verificationDate !== date) {
      throw new Error("Verification date mismatch");
    }

    if (json.hash !== codeCellHash) {
      throw new Error("Code hash mismatch");
    }

    const compiler = this.compilers[json.compiler];

    // TODO this part won't work past the unit tests
    // Need to persist sources to disk and pass the path to the compiler
    // Or maybe just pass the content to the compiler and let it handle it
    const sources = await Promise.all(
      json.sources.map((s) => {
        const content = this.ipfsProvider.read(s.url);

        return {
          ...s,
          path: "",
        };
      }),
    );

    const sourceToVerify: SourceVerifyPayload = {
      sources: sources,
      compiler: json.compiler,
      compilerSettings: json.compilerSettings,
      knownContractAddress: json.knownContractAddress,
      knownContractHash: json.hash,
      tmpDir: "",
      senderAddress: senderAddress.toFriendly(),
    };

    const compileResult = await compiler.verify(sourceToVerify);

    if (compileResult.result !== "similar") {
      throw new Error("Invalid compilation result");
    }

    let mostDeepSigCell = cell.refs[1];

    while (true) {
      if (mostDeepSigCell.refs.length === 0) {
        break;
      } else if (mostDeepSigCell.refs.length > 1) {
        throw new Error("Invalid signature cell");
      }
      mostDeepSigCell = mostDeepSigCell.refs[0];
    }

    const { sigCell } = this.signatureCell(cell.refs[0]);

    mostDeepSigCell.refs.push(sigCell);

    return {
      msgCell: cell.toBoc(),
    };
  }

  private signatureCell(msgToSign: Cell) {
    const sig = Buffer.from(tweetnacl.sign.detached(msgToSign.hash(), this.keypair.secretKey));

    const sigCell = beginCell()
      .storeBuffer(sig)
      .storeBuffer(Buffer.from(this.keypair.publicKey))
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
      .storeBuffer(this.VERIFIER_SHA256)
      .storeUint(Math.floor(Date.now() / 1000) + 60 * 10, 32) // Valid until 10 minutes from now
      .storeAddress(Address.parse(senderAddress))
      .storeAddress(Address.parse(sourcesRegistry))
      .storeRef(deploySource(queryId, codeCellHash, ipfsLink, this.VERIFIER_SHA256))
      .endCell();
  }
}
