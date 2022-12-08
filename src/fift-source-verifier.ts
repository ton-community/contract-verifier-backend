import { promisify } from "util";
import { exec } from "child_process";
const execAsync = promisify(exec);
import { readFile, writeFile } from "fs/promises";
import { CompileResult, FuncCompilerVersion, SourceVerifier, SourceVerifyPayload } from "./types";
import path from "path";
import { Cell } from "ton";
import { fiftlibVersion, fiftVersions, funcCompilers } from "./binaries";

export async function fiftToCodeCell(
  funcVersion: FuncCompilerVersion,
  fiftFile: string,
  tmpDir: string,
) {
  const b64OutFile = `${fiftFile}-b64.cell`;

  const fiftCellSource = `"${fiftFile}" include \n
boc>B "${b64OutFile}" B>file`;

  const tmpB64Fift = path.join(tmpDir, `${fiftFile}.cell.tmp.fif`);
  await writeFile(tmpB64Fift, fiftCellSource);

  const executable = path.join(process.cwd(), funcCompilers[funcVersion], "fift");

  process.env.FIFTPATH = path.join(process.cwd(), "resources", "fiftlib");

  await execAsync(`${executable} -s ${tmpB64Fift}`);

  return Cell.fromBoc(await readFile(b64OutFile))[0];
}

export class FiftSourceVerifier implements SourceVerifier {
  async verify(payload: SourceVerifyPayload): Promise<CompileResult> {
    const funcVersion: FuncCompilerVersion = "0.3.0"; // Single version, assuming fift doesn't affect code hash
    const fiftVersion = fiftVersions[funcVersion];
    const sources = payload.sources.map((s) => ({ filename: s.path }));

    try {
      const cell = await fiftToCodeCell(funcVersion, payload.sources[0].path, payload.tmpDir);
      const hash = cell.hash().toString("base64");

      return {
        hash,
        result: hash === payload.knownContractHash ? "similar" : "not_similar",
        error: null,
        compilerSettings: {
          fiftlibVersion,
          fiftVersion,
        },
        sources,
      };
    } catch (e) {
      console.error(e);
      return {
        hash: null,
        result: "unknown_error",
        error: e.toString(),
        compilerSettings: {
          fiftlibVersion,
          fiftVersion,
        },
        sources,
      };
    }
  }
}
