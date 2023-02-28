import { Cell } from "ton";
import {
  SourceVerifier,
  SourceVerifyPayload,
  CompileResult,
  TactCliCompileSettings,
} from "../types";
import { PackageFileFormat, verify } from "@tact-lang/compiler";
import path from "path";

type FileSystem = {
  readFile: (path: string) => Promise<Buffer>;
  writeFile: (path: string, content: string | Buffer) => Promise<void>;
};

export class TactSourceVerifier implements SourceVerifier {
  fileSystem: FileSystem;

  constructor(fileSystem: FileSystem) {
    this.fileSystem = fileSystem;
  }

  async verify(payload: SourceVerifyPayload): Promise<CompileResult> {
    const pkg = (
      await this.fileSystem.readFile(path.join(payload.tmpDir, payload.sources[0].path))
    ).toString("utf8");

    const pkgParsed: PackageFileFormat = JSON.parse(pkg);

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
          tactVersion: pkgParsed.compiler.version,
          parameters: pkgParsed.compiler.parameters,
        },
        error: [v.error, ...output].join("\n"),
        hash: null,
        result: v.error === "verification-failed" ? "not_similar" : "unknown_error",
        sources: [],
      };
    }

    return {
      compilerSettings: {
        tactVersion: pkgParsed.compiler.version,
        parameters: pkgParsed.compiler.parameters,
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
