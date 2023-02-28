import { Cell } from "ton";
import {
  SourceVerifier,
  SourceVerifyPayload,
  CompileResult,
  TactCliCompileSettings,
} from "../types";
import { verify } from "@tact-lang/compiler";

export class TactSourceVerifier implements SourceVerifier {
  readFile: (path: string) => Promise<Buffer>;

  constructor(readFile: (path: string) => Promise<Buffer>) {
    this.readFile = readFile;
  }

  async verify(payload: SourceVerifyPayload): Promise<CompileResult> {
    const pkg = (await this.readFile(payload.sources[0].path)).toString("utf8");
    console.log(pkg);
    const tactVersion = (payload.compilerSettings as TactCliCompileSettings).tactVersion;

    const output: string[] = [];

    const v = await verify({
      pkg,
      logger: {
        error: output.push,
        log: output.push,
      },
    });

    if (!v.ok) {
      return {
        compilerSettings: {
          tactVersion,
        },
        error: [v.error, ...output].join("\n"),
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
