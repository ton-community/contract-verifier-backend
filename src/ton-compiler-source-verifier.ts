import {
  SourceVerifier,
  SourceVerifyPayload,
  CompileResult,
  NpmTonCompilerSettings,
} from "./types";
import { compileContract } from "ton-compiler";
import path from "path";
import { Cell } from "ton";

export class TonCompilerSourceVerifier implements SourceVerifier {
  async verify(payload: SourceVerifyPayload): Promise<CompileResult> {
    let error;
    let result;
    try {
      result = await compileContract({
        files: payload.sources.map((s) => path.resolve(payload.tmpDir, s.path)),
        stdlib: false,
        version: (payload.compilerSettings as NpmTonCompilerSettings).version,
      });
      if (!result.ok) {
        error = result.log;
      }
    } catch (e) {
      error = e.toString();
    }

    const hash = result?.output ? Cell.fromBoc(result.output)[0].hash().toString("base64") : null;

    return {
      hash: hash,
      result: error
        ? "unknown_error"
        : hash === payload.knownContractHash
        ? "similar"
        : "not_similar",
      error: error,
      compilerSettings: {
        version: (payload.compilerSettings as NpmTonCompilerSettings).version,
        npmVersion: "2.0.0",
      },
    };
  }
}
