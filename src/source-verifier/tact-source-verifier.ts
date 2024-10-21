import path from "path";
import semver from "semver";
import type { verify as VerifyFunctionLegacy } from "tact-1.4.0";
import { Logger, PackageFileFormat } from "tact-1.4.1";
import type { verify as VerifyFunction } from "tact-1.5.2";
import { Cell } from "ton";
import { getSupportedVersions } from "../fetch-compiler-versions";
import { CompileResult, SourceVerifier, SourceVerifyPayload } from "../types";
import { timeoutPromise } from "../utils";

export type FileSystem = {
  readFile: (path: string) => Promise<Buffer>;
  writeFile: (path: string, content: string | Buffer) => Promise<void>;
  readdir: (path: string) => Promise<string[]>;
};

class OutputAppendingLogger extends Logger {
  messages: unknown[] = [];
  debug(message: string) {
    this.messages.push(message);
  }
  info(message: string | Error): void {
    this.messages.push(message);
  }
  warn(message: string | Error): void {
    this.messages.push(message);
  }
  error(message: string | Error): void {
    this.messages.push(message);
  }
}

export class TactSourceVerifier implements SourceVerifier {
  fileSystem: FileSystem;

  constructor(fileSystem: FileSystem) {
    this.fileSystem = fileSystem;
  }

  private isLegacyLogger(
    verify: typeof VerifyFunctionLegacy | typeof VerifyFunction,
    version: string,
  ): verify is typeof VerifyFunctionLegacy {
    return semver.lte(version, "1.4.0");
  }

  async verify(payload: SourceVerifyPayload): Promise<CompileResult> {
    try {
      // Sort by depth because we want the original (top-level) pkg file
      const pkgFilePath = payload.sources
        .sort((a, b) => {
          const depthA = a.path.split("/").length;
          const depthB = b.path.split("/").length;
          return depthA - depthB;
        })
        .find((s) => s.path.endsWith(".pkg"))!.path;

      const pkg = (await this.fileSystem.readFile(path.join(payload.tmpDir, pkgFilePath))).toString(
        "utf8",
      );

      const pkgParsed: PackageFileFormat = JSON.parse(pkg);

      // Fix windows paths (START) - tact 1.3.0 should handle this automatically
      if (pkgParsed.sources) {
        pkgParsed.sources = Object.fromEntries(
          Object.entries(pkgParsed.sources).map(([key, value]) => [key.replace(/\\/g, "/"), value]),
        );
      }

      try {
        const parameters = JSON.parse(pkgParsed.compiler.parameters ?? "{}");
        if (parameters.entrypoint) {
          pkgParsed.compiler.parameters = pkgParsed.compiler.parameters?.replace(/\\/g, "/");
        }
      } catch (e) {
        console.warn("Unable to replace windows paths in entrypoint. ", pkgParsed.compiler);
      }
      // Fix windows paths (END)

      const compilerSettings = {
        tactVersion: pkgParsed.compiler.version,
        parameters: pkgParsed.compiler.parameters,
      };

      const output: string[] = [];

      const { tactVersions } = await getSupportedVersions();

      if (!tactVersions.includes(pkgParsed.compiler.version)) {
        throw new Error("Unsupported tact version: " + pkgParsed.compiler.version);
      }

      const verify: typeof VerifyFunctionLegacy | typeof VerifyFunction = await import(
        `tact-${pkgParsed.compiler.version}`
      )
        .then((m) => m.verify)
        .catch((e) => {
          output.push(
            `Failed to load tact v${pkgParsed.compiler.version}. It probably doesn't exist on the server.`,
          );
          throw e;
        });

      let vPromise;

      if (this.isLegacyLogger(verify, pkgParsed.compiler.version)) {
        vPromise = verify({
          pkg,
          logger: {
            log: (message: string) => output.push(message),
            error: (message: string) => output.push(message),
          },
        });
      } else {
        vPromise = verify({
          pkg,
          logger: new OutputAppendingLogger(),
        });
      }

      const v = await timeoutPromise(vPromise, parseInt(process.env.COMPILE_TIMEOUT ?? "3000"));

      if (!v.ok) {
        console.log(output, "shahar", v.error);
        console.error("Failed to compile tact package", output.join("\n"));
        return {
          compilerSettings,
          error: [v.error, ...output].join("\n"),
          hash: null,
          result: v.error === "verification-failed" ? "not_similar" : "unknown_error",
          sources: [],
        };
      }

      const sources = await Promise.all(
        Object.entries(v.files)
          .filter(([filename]) => filename.match(/\.(abi|tact|pkg)$/) && !filename.match(/\.\./))
          .map(async ([filename, contentB64]) => {
            const writePath = path.join(payload.tmpDir, filename);
            let content = Buffer.from(contentB64, "base64").toString("utf-8");
            if (filename.match(/\.(abi)/)) {
              content = JSON.stringify(JSON.parse(content), null, 3);
            }
            await this.fileSystem.writeFile(writePath, content);
            return { filename };
          }),
      );

      /*
      Add the original pkg file here. 
      The reason for this is because in a verify flow what could happen is this:
      1. User supplies "X.pkg" as source of truth
      2. Tact source verifier on BE1 compiles and generates X.pkg, but also Y.pkg (this is possible due to the nature of tact compiler, which will generate a pkg file per contract)
      3. Tact source verifier on BE2, trying to verify BE1 result, now has ambiguity on which pkg file to use

      Therefore we only add the original pkg file
      */
      sources.push({ filename: pkgFilePath });

      const compiledHash = Cell.fromBoc(Buffer.from(v.package.code, "base64"))[0]
        .hash()
        .toString("base64");

      return {
        compilerSettings,
        error: null,
        hash: compiledHash,
        result: compiledHash === payload.knownContractHash ? "similar" : "not_similar",
        sources: sources.sort(
          ({ filename: filenameA }, { filename: filenameB }) =>
            (filenameA.endsWith(".tact") ? 1 : 0) - (filenameB.endsWith(".tact") ? 1 : 0),
        ),
      };
    } catch (e) {
      return {
        error: JSON.stringify(e, Object.getOwnPropertyNames(e)),
        hash: null,
        compilerSettings: { tactVersion: "unknown" },
        sources: [],
        result: "unknown_error",
      };
    }
  }
}
