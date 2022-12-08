import fs from "fs";
import path from "path";
import { funcCompilers } from "./binaries";
export function checkPrerequisites() {
  const missingEnvVars = [
    "VERIFIER_ID",
    "SOURCES_REGISTRY",
    "INFURA_ID",
    "INFURA_SECRET",
    "PRIVATE_KEY",
  ]
    .filter((e) => !process.env[e])
    .join(" ");

  if (missingEnvVars) throw new Error("Missing env vars: " + missingEnvVars);

  const missingFiles = Object.values(funcCompilers)
    .map((versionDir) => [
      path.join(versionDir, "func"),
      path.join(versionDir, "fift"),
      path.join(versionDir, "fiftlib", "Asm.fif"),
      path.join(versionDir, "fiftlib", "Fift.fif"),
    ])
    .flat()
    .filter((f) => !fs.existsSync(path.join(process.cwd(), f)))
    .join(" ");

  if (missingFiles) throw new Error("Missing files: " + missingFiles);
}
