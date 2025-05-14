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
  static async tryImport(compiler: "tact" | "func", version: string) {
    const versions = await supportedVersionsReader.versions();

    let installPath, modulePath, npmPackage: string;

    if (compiler === "tact") {
      if (!versions.tactVersions.includes(version)) {
        throw new Error(`Unsupported tact version:${version}`);
      }
      installPath = path.resolve(process.cwd(), `compilers/tact-compiler-${version}`);

      modulePath = path.join(installPath, "node_modules", "@tact-lang", "compiler");
      npmPackage = "@tact-lang/compiler";
    } else {
      if (!versions.funcVersions.includes(version)) {
        throw new Error(`Unsupported func version:${version}`);
      }

      installPath = path.resolve(process.cwd(), `compilers/func-compiler-${version}`);

      modulePath = path.join(installPath, "node_modules", "@ton-community", "func-js-bin");
      npmPackage = "@ton-community/func-js-bin";
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
        ).finally(() => {
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
