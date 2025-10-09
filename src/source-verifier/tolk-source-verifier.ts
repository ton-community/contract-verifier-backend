import path from "path";
import {
  CompileResult,
  SourceVerifier,
  SourceVerifyPayload,
  TolkCliCompileSettings,
  TolkSourceToVerify,
} from "../types";
import { supportedVersionsReader } from "../supported-versions-reader";
import type { runTolkCompiler as CompileFunction } from "tolk-0.12.0";
import { readFileSync } from "fs";
import { timeoutPromise } from "../utils";
import { DynamicImporter } from "../dynamic-importer";
import { getLogger } from "../logger";

// Matches tolk fsReadCallback. Synchronous for whatever reason??
export type TolkVerifierReadCallback = (path: string) => string;

const logger = getLogger("tolk-verifier");

export class TolkSourceVerifier implements SourceVerifier {
  readFile: TolkVerifierReadCallback;

  constructor(fileHook?: TolkVerifierReadCallback) {
    if (fileHook) {
      this.readFile = fileHook;
    } else {
      this.readFile = (path: string) => readFileSync(path, { encoding: "utf8" });
    }
  }
  async verify(payload: SourceVerifyPayload): Promise<CompileResult> {
    const tolkCompilerOpts: TolkCliCompileSettings =
      payload.compilerSettings as TolkCliCompileSettings;

    try {
      if (payload.compiler !== "tolk") {
        throw "Invalid compiler type passed as tolk:" + payload.compiler;
      }

      const entry = payload.sources.filter((s: TolkSourceToVerify) => s.isEntrypoint);

      if (entry.length == 0) {
        throw new Error("No entrypoint found");
      }
      if (entry.length > 1) {
        throw new Error("Multiple entrypoints found");
      }

      const entryPath = path.join(payload.tmpDir, entry[0].path);

      const tolkModule = await DynamicImporter.tryImport("tolk", tolkCompilerOpts.tolkVersion);

      const tolkCompile: typeof CompileFunction = tolkModule.runTolkCompiler;

      const compileRes = await timeoutPromise(
        tolkCompile({
          entrypointFileName: entryPath,
          fsReadCallback: (filePath) => {
            if (payload.tmpDir) {
              // Make sure compiler is not allowed to include files outside of the temp dir
              const rootPath = filePath.slice(0, payload.tmpDir.length);
              const remainingPath = filePath.slice(payload.tmpDir.length);
              if (
                rootPath != payload.tmpDir ||
                remainingPath[0] != path.sep ||
                path.relative(payload.tmpDir, filePath) != remainingPath.slice(1)
              ) {
                throw new Error(`Invalid include path: ${filePath}`);
              }
            }

            return this.readFile(filePath);
          },
        }),
        parseInt(process.env.COMPILE_TIMEOUT ?? "1000"),
      );

      if (compileRes.status == "error") {
        return {
          result: "compile_error",
          error: compileRes.message,
          hash: null,
          compilerSettings: tolkCompilerOpts.tolkVersion,
          sources: payload.sources.map((s) => {
            return { filename: s.path };
          }),
        };
      }

      const base64Hash = Buffer.from(compileRes.codeHashHex, "hex").toString("base64");
      return {
        hash: base64Hash,
        result: base64Hash === payload.knownContractHash ? "similar" : "not_similar",
        error: null,
        compilerSettings: tolkCompilerOpts,
        sources: payload.sources.map((s: TolkSourceToVerify) => {
          return {
            filename: s.path,
            isEntrypoint: s.isEntrypoint
          };
        }),
      };
    } catch (e) {
      logger.error(e);
      return {
        result: "unknown_error",
        compilerSettings: tolkCompilerOpts,
        error: e.toString(),
        hash: null,
        sources: payload.sources.map((s) => {
          return { filename: s.path };
        }),
      };
    }
  }
}
