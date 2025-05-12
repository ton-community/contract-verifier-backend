import { exec } from "child_process";
import { access } from "fs/promises";
import path from "path";
import { promisify } from "util";
import { supportedVersionsReader } from "./supported-versions-reader";

const execAsync = promisify(exec);

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

    try {
      await access(modulePath);
      return await import(modulePath);
    } catch {
      console.log(`Version ${version} not found, installing...`);
      await execAsync(`npm install ${npmPackage}@${version} --prefix ${installPath}`);
      return await import(modulePath);
    }
  }
}
