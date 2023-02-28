import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import { exec } from "child_process";
import { Cell } from "ton";
import { SourceVerifier, SourceVerifyPayload, CompileResult } from "../types";
import { run } from "@tact-lang/compiler";

const execAsync = promisify(exec);

export class TactSourceVerifier implements SourceVerifier {
  async verify(payload: SourceVerifyPayload): Promise<CompileResult> {
    console.log(payload.sources, process.cwd());

    const files = {
      [payload.sources[0].path]: (await fs.readFile(payload.sources[0].path)).toString("base64"),
    };

    const config = {
      projects: [
        {
          name: "proj",
          path: payload.sources[0].path,
          output: "",
        },
      ],
    };

    const res = await run({ config, files });

    // const res = await execAsync(`npx tact --config ${tactConfig}`);

    console.log(Object.keys(files));

    const dirContents = files;
    // TODO perhaps a multi-contract tact project won't work
    const bocFilename = Object.keys(dirContents).filter((x) => x.endsWith(".boc"))?.[0];
    const abiFilename = Object.keys(dirContents).filter((x) => x.endsWith(".abi"))?.[0];

    if (!bocFilename || !abiFilename) {
      return {
        compilerSettings: { tactVersion: "0.5.0" },
        error: String("Did compilation succeed: " + String(res)),
        hash: null,
        result: "unknown_error",
        sources: [],
      };
    }

    const boc = Buffer.from(files[bocFilename], "base64");
    const hash = Cell.fromBoc(boc)[0].hash().toString("base64");

    return {
      compilerSettings: {
        tactVersion: "0.5.0",
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
