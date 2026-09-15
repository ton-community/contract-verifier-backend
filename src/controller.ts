import {
  SourceVerifier,
  SourceVerifyPayload,
  FiftSourceCompileResult,
  FuncSourceCompileResult,
  TactSourceCompileResult,
  TolkSourceCompileResult,
} from "./types";
import path from "path";
import tweetnacl from "tweetnacl";
import { VerifyResult, Compiler, SourceItem } from "./types";
import { Cell } from "@ton/core";
import { CodeStorageProvider } from "./codestorage/provider";
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
import mkdirp from "mkdirp";
import { getLogger } from "./logger";

export type Base64URL = string;

const logger = getLogger("controller");

interface ControllerConfig {
  verifierId: string;
  privateKey: string;
  sourcesRegistryAddress: string;
  allowReverification: boolean;
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
    logger.info("Starting source verification", {
      compiler: verificationPayload.compiler,
      knownContractHash: verificationPayload.knownContractHash,
      sourcesCount: verificationPayload.sources.length,
    });

    // Compile
    logger.debug("Compiling sources", { compiler: verificationPayload.compiler });
    const compiler = this.compilers[verificationPayload.compiler];
    const compileResult = await compiler.verify(verificationPayload);

    if (compileResult.error || compileResult.result !== "similar" || !compileResult.hash) {
      logger.warn("Compilation failed or hash mismatch", {
        result: compileResult.result,
        error: compileResult.error,
        hash: compileResult.hash,
      });
      return {
        compileResult,
      };
    }

    logger.info("Compilation successful", {
      hash: compileResult.hash,
      result: compileResult.result,
    });

    if (!this.config.allowReverification) {
      logger.debug("Checking if proof already deployed");
      const isDeployed = await this.tonReaderClient.isProofDeployed(
        verificationPayload.knownContractHash,
        this.config.verifierId,
        this.config.sourcesRegistryAddress,
      );
      if (isDeployed) {
        logger.warn("Contract already verified", {
          knownContractHash: verificationPayload.knownContractHash,
        });
        return {
          compileResult: {
            result: "unknown_error",
            error: "Proof has already been deployed",
            hash: null,
            compilerSettings: compileResult.compilerSettings,
            sources: compileResult.sources,
          },
        };
      }
      logger.debug("Proof not deployed, proceeding");
    }

    // Upload sources to IPFS
    const sourcesToUpload = compileResult.sources.map(
      (
        s:
          | FuncSourceCompileResult
          | FiftSourceCompileResult
          | TolkSourceCompileResult
          | TactSourceCompileResult,
      ) => ({
        path: path.join(verificationPayload.tmpDir, s.filename),
        name: s.filename,
      }),
    );

    logger.info("Uploading sources to IPFS", {
      sourcesCount: sourcesToUpload.length,
    });
    const fileLocators = await this.ipfsProvider.write(sourcesToUpload, true);
    logger.info("Sources uploaded to IPFS", {
      filesUploaded: fileLocators.length,
    });

    let compilerOutputUrl: string | undefined;
    if (compileResult.compilerOutput && Object.keys(compileResult.compilerOutput).length > 0) {
      logger.debug("Uploading compiler output to IPFS");
      const [url] = await this.ipfsProvider.writeFromContent(
        [Buffer.from(JSON.stringify(compileResult.compilerOutput))],
        true,
      );
      compilerOutputUrl = url;
      logger.info("Compiler output uploaded", { compilerOutputUrl });
    }

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
      ...(compilerOutputUrl ? { compilerOutputUrl } : {}),
    };

    // Upload source spec JSON to IPFS
    logger.debug("Uploading source spec to IPFS");
    const [ipfsLink] = await this.ipfsProvider.writeFromContent(
      [Buffer.from(JSON.stringify(sourceSpec))],
      true,
    );

    logger.info("Source spec uploaded", { ipfsLink });

    const queryId = random64BitNumber();
    logger.debug("Signing message", { queryId });

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

    logger.info("Source verification completed successfully", {
      ipfsLink,
      hash: compileResult.hash,
    });

    return {
      compileResult,
      sig: sig.toString("base64"),
      ipfsLink: ipfsLink,
      msgCell: verifierRegistryForwardMessage(queryId, msgToSign, sigCell),
    };
  }

  public async sign({ messageCell, tmpDir }: { messageCell: Buffer; tmpDir: string }) {
    logger.info("Starting message signing");

    const cell = Cell.fromBoc(Buffer.from(messageCell))[0];

    logger.debug("Getting verifier config");
    const verifierConfig = await this.tonReaderClient.getVerifierConfig(
      this.config.verifierId,
      this.config.sourcesRegistryAddress,
    );

    logger.debug("Validating message cell");
    const { ipfsPointer, codeCellHash, senderAddress, queryId } = validateMessageCell(
      cell,
      this.VERIFIER_SHA256,
      this.config.sourcesRegistryAddress,
      this.keypair,
      verifierConfig,
    );

    logger.debug("Reading source spec from IPFS", { ipfsPointer });
    const sourceTemp = await this.ipfsProvider.read(ipfsPointer);

    const json: SourceItem = JSON.parse(sourceTemp);

    logger.debug("Verifying code hash", {
      expectedHash: codeCellHash,
      actualHash: json.hash,
    });

    if (json.hash !== codeCellHash) {
      logger.error("Code hash mismatch", {
        expectedHash: codeCellHash,
        actualHash: json.hash,
      });
      throw new Error("Code hash mismatch");
    }

    const compiler = this.compilers[json.compiler];

    logger.debug("Reading sources from IPFS", {
      sourcesCount: json.sources.length,
      compiler: json.compiler,
    });

    const sources = await Promise.all(
      json.sources.map(async (s) => {
        const content = await this.ipfsProvider.read(s.url);
        const filePath = path.join(tmpDir, s.filename);

        await mkdirp(filePath.substring(0, filePath.lastIndexOf("/")));
        await writeFile(filePath, content);

        return {
          ...s,
          path: s.filename,
        };
      }),
    );

    logger.info("Sources downloaded from IPFS", {
      sourcesCount: sources.length,
    });

    const sourceToVerify: SourceVerifyPayload = {
      sources: sources,
      compiler: json.compiler,
      compilerSettings: {
        ...json.compilerSettings,
        // TODO this is a hack because only func has a command line arg for now.
        // @ts-ignore
        commandLine: json.compilerSettings?.commandLine?.replace(/^func/, ""),
      },
      knownContractAddress: json.knownContractAddress,
      knownContractHash: json.hash,
      tmpDir: tmpDir,
      senderAddress: senderAddress.toString(),
    };

    logger.debug("Verifying compilation");
    const compileResult = await compiler.verify(sourceToVerify);

    if (compileResult.result !== "similar") {
      logger.error("Compilation verification failed", {
        result: compileResult.result,
        error: compileResult.error,
      });
      throw new Error("Invalid compilation result: " + compileResult.result);
    }

    logger.info("Compilation verified successfully");

    logger.debug("Creating signature cell");
    const slice = cell.beginParse();
    const msgToSign = slice.loadRef();
    const { sigCell } = signatureCell(msgToSign, this.keypair);
    let updateSigCell = addSignatureCell(slice.loadRef(), sigCell);

    logger.info("Message signing completed successfully");

    return {
      msgCell: slice.asBuilder().storeRef(msgToSign).storeRef(updateSigCell).asCell().toBoc(),
    };
  }
}

function addSignatureCell(node: Cell, sigCell: Cell): Cell {
  const slice = node.beginParse();
  if (slice.remainingRefs > 0) {
    const child = slice.loadRef();
    if (slice.remainingRefs > 0) {
      throw new Error("Each signature cell should have at most one ref to another sig cell");
    }

    return slice.asBuilder().storeRef(addSignatureCell(child, sigCell)).asCell();
  }

  return slice.asBuilder().storeRef(sigCell).asCell();
}
