import { exec } from "child_process";
import { access } from "fs/promises";
import path from "path";
import { promisify } from "util";
import { supportedVersionsReader } from "./supported-versions-reader";
import { getLogger } from "./logger";

const execAsync = promisify(exec);

const pendingInstallations: { [v: string]: Promise<any> } = {};

const logger = getLogger("dynamic-importer");

export class DynamicImporter {
  static async tryImport(compiler: "tact" | "func" | "tolk", version: string) {
    const versions = await supportedVersionsReader.versions();

    let installPath, modulePath, npmPackage: string;

    if (compiler === "tact") {
      if (!versions.tactVersions.includes(version)) {
        throw new Error(`Unsupported tact version:${version}`);
      }
      installPath = path.resolve(process.cwd(), `compilers/tact-compiler-${version}`);

      modulePath = path.join(installPath, "node_modules", "@tact-lang", "compiler");
      npmPackage = "@tact-lang/compiler";
    } else if (compiler === "func") {
      if (!versions.funcVersions.includes(version)) {
        throw new Error(`Unsupported func version:${version}`);
      }

      installPath = path.resolve(process.cwd(), `compilers/func-compiler-${version}`);

      modulePath = path.join(installPath, "node_modules", "@ton-community", "func-js-bin");
      npmPackage = "@ton-community/func-js-bin";
    } else if (compiler === "tolk") {
      if (!versions.tolkVersions.includes(version)) {
        throw new Error(`Unsupported tolk version:${version}`);
      }

      installPath = path.resolve(process.cwd(), "compilers", `tolk-compiler-${version}`);
      modulePath = path.join(installPath, "node_modules", "@ton", "tolk-js");
      npmPackage = "@ton/tolk-js";
    } else {
      throw new Error(`Compiler ${compiler} is not yet supported`);
    }

    const key = `${compiler}${version}`;

    // if undefined, will just continue
    await pendingInstallations[key];

    try {
      await access(modulePath);
      return await import(modulePath);
    } catch {
      if (!pendingInstallations[key]) {
        logger.debug(`Version ${version} not found, installing...`);

        pendingInstallations[key] = execAsync(
          `npm install ${npmPackage}@${version} --prefix ${installPath}`,
        )
          .catch((err) => {
            const installOutput =
              `Installation of ${compiler} v${version} failed: ${err.stdout || ""}\n${err.stderr || ""}`.trim();
            logger.error(installOutput);
            // Throwing further
            throw new Error(installOutput);
          })
          .finally(() => {
            delete pendingInstallations[key];
          });
      } else {
        logger.debug(`Installation for ${key} already in progress`);
      }

      await pendingInstallations[key];

      return await import(modulePath);
    }
  }
}
