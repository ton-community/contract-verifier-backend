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

    const sources = (
      await Promise.all(
        Object.entries(v.files)
          .filter(([filename]) => !filename.match(/\.(fif|boc|ts|md)/))
          .map(async ([filename, contentB64]) => {
            const writePath = path.join(payload.tmpDir, filename);
            let content = Buffer.from(contentB64, "base64").toString("utf-8");
            if (filename.match(/\.(pkg|abi)/)) {
              content = JSON.stringify(JSON.parse(content), null, 3);
            }
            await this.fileSystem.writeFile(writePath, content);
            return { filename };
          }),
      )
    ).sort(
      ({ filename: filenameA }, { filename: filenameB }) =>
        (filenameA.endsWith(".tact") ? 1 : 0) - (filenameB.endsWith(".tact") ? 1 : 0),
    );

    return {
      compilerSettings: {
        tactVersion: pkgParsed.compiler.version,
        parameters: pkgParsed.compiler.parameters,
      },
      error: null,
      hash: Cell.fromBoc(Buffer.from(v.package.code, "base64"))[0].hash().toString("base64"),
      result: "similar",
      sources,
    };
  }
}
