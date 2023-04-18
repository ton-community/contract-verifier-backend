import axios from "axios";
let funcVersions: string[] | null = null;

export async function getFuncVersions() {
  if (!funcVersions) {
    const { data } = await axios.get(
      "https://raw.githubusercontent.com/ton-community/contract-verifier-config/main/config.json",
      { responseType: "json" },
    );
    funcVersions = data.funcVersions;
  }

  return funcVersions;
}
