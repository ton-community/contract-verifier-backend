import fs from "fs";
import path from "path";
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

  const missingFiles = [
    path.join("resources", "fiftlib", "Asm.fif"),
    path.join("resources", "fiftlib", "Fift.fif"),
    path.join("resources", "binaries", "0.2.0", "func"),
    path.join("resources", "binaries", "0.2.0", "fift"),
    path.join("resources", "binaries", "0.3.0", "func"),
    path.join("resources", "binaries", "0.3.0", "fift"),
  ]
    .filter((f) => !fs.existsSync(path.join(process.cwd(), f)))
    .join(" ");

  if (missingFiles) throw new Error("Missing files: " + missingFiles);
}
