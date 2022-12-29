import {
  SourceVerifier,
  SourceVerifyPayload,
  FiftSourceCompileResult,
  FuncSourceCompileResult,
  TactSourceCompileResult,
} from "./types";
import path from "path";
import tweetnacl from "tweetnacl";
import { VerifyResult, Compiler, SourceItem } from "./types";
import { Address, beginCell, Cell } from "ton";
import BN from "bn.js";
import { CodeStorageProvider } from "./ipfs-code-storage-provider";
import { sha256, random64BitNumber, getNowHourRoundedDown } from "./utils";
import { TonReaderClient } from "./ton-reader-client";
import { validateMessageCell } from "./validate-message-cell";
import { writeFile } from "fs/promises";
import {
  cellToSign,
  deploySource,
  signatureCell,
  verifierRegistryForwardMessage,
} from "./cell-builders";

export type Base64URL = string;

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
    const msgToSign = cellToSign(
      verificationPayload.senderAddress,
      queryId,
      compileResult.hash!,
      ipfsLink,
      this.config.sourcesRegistryAddress,
      this.VERIFIER_SHA256,
    );

    const { sig, sigCell } = signatureCell(msgToSign, this.keypair);

    return {
      compileResult,
      sig: sig.toString("base64"),
      ipfsLink: ipfsLink,
      msgCell: verifierRegistryForwardMessage(queryId, msgToSign, sigCell),
    };
  }

  public async sign({ messageCell, tmpDir }: { messageCell: Buffer; tmpDir: string }) {
    const cell = Cell.fromBoc(messageCell)[0];

    const verifierConfig = await this.tonReaderClient.getVerifierConfig(
      this.config.verifierId,
      this.config.verifierRegistryAddress,
    );

    const { ipfsPointer, codeCellHash, senderAddress, queryId } = validateMessageCell(
      cell,
      this.VERIFIER_SHA256,
      this.config.sourcesRegistryAddress,
      this.keypair,
      verifierConfig,
    );

    const json: SourceItem = JSON.parse(await this.ipfsProvider.read(ipfsPointer));

    if (json.hash !== codeCellHash) {
      throw new Error("Code hash mismatch");
    }

    const compiler = this.compilers[json.compiler];

    // TODO this part won't work past the unit tests
    // Need to persist sources to disk and pass the path to the compiler
    // Or maybe just pass the content to the compiler and let it handle it
    const sources = await Promise.all(
      json.sources.map(async (s) => {
        const content = await this.ipfsProvider.read(s.url);
        const filePath = path.join(tmpDir, s.filename);

        await writeFile(filePath, content);

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
      }
      mostDeepSigCell = mostDeepSigCell.refs[0];
    }

    const { sigCell } = signatureCell(cell.refs[0], this.keypair);
    mostDeepSigCell.refs.push(sigCell);

    return {
      msgCell: cell.toBoc(),
    };
  }
}
