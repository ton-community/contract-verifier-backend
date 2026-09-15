import { FuncCompiler } from "@ton-community/func-js";
import { readFile } from "fs/promises";
import path from "path";
import { Cell } from "@ton/core";
import { DynamicImporter } from "../dynamic-importer";
import {
  CompileResult,
  FuncCliCompileSettings,
  FuncSourceToVerify,
  SourceVerifier,
  SourceVerifyPayload,
} from "../types";
import { getLogger } from "../logger";

const logger = getLogger("funcjs-verifier");

export class FuncJSSourceVerifier implements SourceVerifier {
  async verify(payload: SourceVerifyPayload): Promise<CompileResult> {
    logger.info("Starting FuncJS verification", {
      sourcesCount: payload.sources.length,
      funcVersion: (payload.compilerSettings as FuncCliCompileSettings).funcVersion,
    });

    let funcCmd: string | null = null;
    const compilerSettings = payload.compilerSettings as FuncCliCompileSettings;

    const sources = payload.sources.map((s: FuncSourceToVerify) => ({
      filename: s.path,
      hasIncludeDirectives: s.hasIncludeDirectives,
      isEntrypoint: s.isEntrypoint,
      isStdLib: s.isStdLib,
      includeInCommand: s.includeInCommand,
    }));

    try {
      logger.debug("Importing func compiler module", {
        version: compilerSettings.funcVersion,
      });
      const module = await DynamicImporter.tryImport("func", compilerSettings.funcVersion);

      logger.debug("Reading source files");
      logger.debug("Compiling with FuncCompiler", {
        targetsCount: payload.sources.filter((s: FuncSourceToVerify) => s.includeInCommand).length,
      });

      const res = await new FuncCompiler(module.object).compileFunc({
        sources: Object.fromEntries(
          await Promise.all(
            payload.sources.map(async (p) => [
              p.path,
              (await readFile(path.join(payload.tmpDir, p.path))).toString(),
            ]),
          ),
        ),
        targets: payload.sources
          .filter((s: FuncSourceToVerify) => s.includeInCommand)
          .map((s) => s.path),
      });

      if (res.status === "error") {
        logger.error("Func compilation failed", { error: res.message });
        throw new Error(res.message);
      }

      const hash = Cell.fromBoc(Buffer.from(res.codeBoc, "base64"))[0].hash().toString("base64");
      const result = hash === payload.knownContractHash ? "similar" : "not_similar";

      logger.info("FuncJS verification completed", {
        hash,
        result,
        matches: result === "similar",
      });

      return {
        hash,
        result,
        error: null,
        compilerSettings: {
          funcVersion: compilerSettings.funcVersion,
          commandLine: compilerSettings.commandLine,
        },
        sources,
      };
    } catch (e) {
      logger.error("FuncJS verification error", { error: e.toString() });
      return {
        result: "unknown_error",
        error: e.toString(),
        hash: null,
        compilerSettings: {
          funcVersion: compilerSettings.funcVersion,
          commandLine: funcCmd ?? "",
        },
        sources,
      };
    }
  }
}
