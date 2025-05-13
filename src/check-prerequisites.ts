import fs from "fs";
import path from "path";
import { binaryPath } from "./binaries";
import { supportedVersionsReader } from "./supported-versions-reader";
import { getLogger } from "./logger";

const logger = getLogger("checkPrereqs");

export async function checkPrerequisites() {
  const missingEnvVars = [
    "VERIFIER_ID",
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

  const { funcVersions } = await supportedVersionsReader.versions();

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

  logger.error("Missing files: " + missingFiles);
}
