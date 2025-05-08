import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { supportedVersionsReader } from "./fetch-compiler-versions";

const execAsync = promisify(exec);

enum CompilerPackage {
  tact = "@tact-lang/compiler",
}

export class DynamicImporter {
  static async tryImport(compiler: "tact" | "func", version: string) {
    const versions = await supportedVersionsReader.versions();

    if (compiler === "tact") {
      if (!versions.tactVersions.includes(version)) {
        throw new Error(`Unsupported tact version:${version}`);
      }
      const installPath = path.resolve(process.cwd(), `compilers/tact-compiler-${version}`);

      const modulePath = path.join(
        installPath,
        "node_modules",
        "@tact-lang",
        "compiler",
        "dist",
        "index.js",
      );

      try {
        return await import(modulePath);
      } catch {
        console.log(`Version ${version} not found, installing...`);
        await execAsync(`npm install ${CompilerPackage.tact}@${version} --prefix ${installPath}`);
        return await import(modulePath);
      }
    } else {
      throw new Error("FunC unsupported");
    }
  }
}
