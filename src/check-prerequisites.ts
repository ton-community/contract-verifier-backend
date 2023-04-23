import fs from "fs";
import path from "path";
import { binaryPath } from "./binaries";
import { getFuncVersions } from "./fetch-func-versions";
export async function checkPrerequisites() {
  const missingEnvVars = [
    "VERIFIER_ID",
    "VERIFIER_REGISTRY",
    "SOURCES_REGISTRY",
    "INFURA_ID",
    "INFURA_SECRET",
    "PRIVATE_KEY",
    "TACT_DEPLOYER_INFURA_ID",
    "TACT_DEPLOYER_INFURA_SECRET",
    "NETWORK",
    "COMPILE_TIMEOUT",
  ]
    .filter((e) => !process.env[e])
    .join(" ");

  if (missingEnvVars) throw new Error("Missing env vars: " + missingEnvVars);

  const funcVersions = await getFuncVersions();

  const missingFiles = funcVersions!
    .map((versionDir: string) => [
      path.join(binaryPath, versionDir, "func"),
      path.join(binaryPath, versionDir, "fift"),
      path.join(binaryPath, versionDir, "fiftlib", "Asm.fif"),
      path.join(binaryPath, versionDir, "fiftlib", "Fift.fif"),
    ])
    .flat()
    .filter((f) => !fs.existsSync(path.join(process.cwd(), f)))
    .join(" ");

  if (missingFiles) throw new Error("Missing files: " + missingFiles);
}
