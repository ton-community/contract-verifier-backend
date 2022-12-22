import { CompileResult, SourceVerifier, SourceVerifyPayload } from "./types";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import { exec } from "child_process";
import { Cell } from "ton";
const execAsync = promisify(exec);

export class TactSourceVerifier implements SourceVerifier {
  async verify(payload: SourceVerifyPayload): Promise<CompileResult> {
    const tactConfig = path.join(payload.tmpDir, "tact.config.json");
    await fs.writeFile(
      tactConfig,
      JSON.stringify({
        projects: [
          {
            name: "proj",
            path: path.join(payload.tmpDir, payload.sources[0].path),
            output: "",
          },
        ],
      }),
    );
    const res = await execAsync(`npx tact --config ${tactConfig}`);

    const dirContents = await fs.readdir(path.join(payload.tmpDir));
    // TODO perhaps a multi-contract tact project won't work
    const bocFilename = dirContents.filter((x) => x.endsWith(".boc"))?.[0];
    const abiFilename = dirContents.filter((x) => x.endsWith(".abi"))?.[0];

    if (res.stderr || !bocFilename || !abiFilename) {
      return {
        compilerSettings: { tactVersion: "0.4.0" },
        error: res.stderr,
        hash: null,
        result: "unknown_error",
        sources: [],
      };
    }

    const boc = await fs.readFile(path.join(payload.tmpDir, bocFilename));
    const hash = Cell.fromBoc(boc)[0].hash().toString("base64");

    return {
      compilerSettings: {
        tactVersion: "0.4.0",
      },
      error: null,
      hash,
      result: hash === payload.knownContractHash ? "similar" : "not_similar",
      sources: [
        {
          filename: payload.sources[0].path,
          type: "code",
        },
        {
          filename: abiFilename,
          type: "abi",
        },
      ],
    };
  }
}
