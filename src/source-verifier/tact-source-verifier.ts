import { Cell } from "ton";
import { SourceVerifier, SourceVerifyPayload, CompileResult } from "../types";
import { PackageFileFormat } from "tact-1.0.0";
import type { verify as VerifyFunction } from "tact-1.0.0";
import path from "path";

export type FileSystem = {
  readFile: (path: string) => Promise<Buffer>;
  writeFile: (path: string, content: string | Buffer) => Promise<void>;
  readdir: (path: string) => Promise<string[]>;
};

export class TactSourceVerifier implements SourceVerifier {
  fileSystem: FileSystem;

  constructor(fileSystem: FileSystem) {
    this.fileSystem = fileSystem;
  }

  async verify(payload: SourceVerifyPayload): Promise<CompileResult> {
    try {
      const pkg = (
        await this.fileSystem.readFile(
          path.join(payload.tmpDir, payload.sources.find((s) => s.path.endsWith(".pkg"))!.path),
        )
      ).toString("utf8");

      const pkgParsed: PackageFileFormat = JSON.parse(pkg);

      const compilerSettings = {
        tactVersion: pkgParsed.compiler.version,
        parameters: pkgParsed.compiler.parameters,
      };

      const output: string[] = [];

      const verify: typeof VerifyFunction = await import(`tact-${pkgParsed.compiler.version}`)
        .then((m) => m.verify)
        .catch((e) => {
          output.push(
            `Failed to load tact v${pkgParsed.compiler.version}. It probably doesn't exist on the server.`,
          );
          throw e;
        });

      const v = await verify({
        pkg,
        logger: {
          error: output.push,
          log: output.push,
        },
      });

      if (!v.ok) {
        return {
          compilerSettings,
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

      const compiledHash = Cell.fromBoc(Buffer.from(v.package.code, "base64"))[0]
        .hash()
        .toString("base64");

      return {
        compilerSettings,
        error: null,
        hash: compiledHash,
        result: compiledHash === payload.knownContractHash ? "similar" : "not_similar",
        sources,
      };
    } catch (e) {
      return {
        error: e.toString(),
        hash: null,
        compilerSettings: { tactVersion: "unknown" },
        sources: [],
        result: "unknown_error",
      };
    }
  }
}
