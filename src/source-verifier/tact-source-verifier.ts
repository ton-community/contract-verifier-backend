import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import { exec } from "child_process";
import { Cell } from "ton";
import {
  SourceVerifier,
  SourceVerifyPayload,
  CompileResult,
  TactCliCompileSettings,
} from "../types";
import { verify } from "@tact-lang/compiler";

const execAsync = promisify(exec);

export class TactSourceVerifier implements SourceVerifier {
  async verify(payload: SourceVerifyPayload): Promise<CompileResult> {
    const pkg = (await fs.readFile(payload.sources[0].path)).toString("utf8");
    const tactVersion = (payload.compilerSettings as TactCliCompileSettings).tactVersion;

    const v = await verify({
      pkg,
      logger: {
        error: console.error,
        log: console.log,
      },
    });

    if (!v.ok) {
      return {
        compilerSettings: {
          tactVersion,
        },
        error: v.error,
        hash: null,
        result: v.error === "verification-failed" ? "not_similar" : "unknown_error",
        sources: [],
      };
    }

    return {
      compilerSettings: {
        tactVersion,
      },
      error: null,
      hash: Cell.fromBoc(Buffer.from(v.package.code, "base64"))[0].hash().toString("base64"),
      result: "similar",
      sources: [
        {
          filename: payload.sources[0].path,
        },
      ],
    };
  }
}
