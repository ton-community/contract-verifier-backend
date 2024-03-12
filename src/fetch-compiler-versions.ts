import axios from "axios";
let versions: {
  funcVersions: string[];
  tactVersions: string[];
} | null = null;

export async function getSupportedVersions() {
  if (!versions) {
    const { data } = await axios.get(
      "https://raw.githubusercontent.com/ton-community/contract-verifier-config/main/config.json",
      { responseType: "json" },
    );
    versions = {
      funcVersions: data.funcVersions,
      tactVersions: data.tactVersions,
    };
  }

  return versions;
}
