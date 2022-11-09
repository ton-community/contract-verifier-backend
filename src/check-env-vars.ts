export function checkEnvVars() {
  const missingEnvVars = [
    "VERIFIER_ID",
    "SOURCES_REGISTRY",
    "INFURA_ID",
    "INFURA_SECRET",
    "PRIVATE_KEY",
  ]
    .filter((e) => !process.env[e])
    .reduce(Array.prototype.join.bind(null, " "));

  if (missingEnvVars) throw new Error("Missing env vars: " + missingEnvVars);
}
