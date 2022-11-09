import { promisify } from "util";
import { exec } from "child_process";
const execAsync = promisify(exec);
import { readFile, writeFile } from "fs/promises";
import { Cell } from "ton";
import { FUNC_COMPILER_VERSION, SourceVerifier, SourceVerifyPayload, CompileResult } from "./types";
import path from "path";

function randomStr(length: number) {
  let result = "";
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

const funcCompilers: { [key in FUNC_COMPILER_VERSION]: string } = {
  "0.0.9": "./binaries/func.0.0.9", // [ Commit: 9875f02ef4ceba5b065d5e63c920f91aec73224e, Date: 2021-11-08 00:10:10 +0300]
  "0.1.0": "./binaries/func.0.1.0", //  [ Commit: 5b9345263efdb78a9723c4f11409eced14912a71, Date: 2021-12-28 14:41:44 +0200]
  // TODO restore "0.2.0": "./binaries/func.0.2.0", // [ Commit: db3619ed310484fcfa4e3565be8e10458f9f2f5f, Date: 2022-05-17 15:56:31 +0300]
  "0.2.0": "func", // [ Commit: db3619ed310484fcfa4e3565be8e10458f9f2f5f, Date: 2022-05-17 15:56:31 +0300]
};

function prepareFuncCommand(
  executable: string,
  funcArgs: string,
  fiftOutFile: string,
  commandLine: string,
) {
  if (/[;>&]/.test(commandLine)) {
    throw new Error("Unallowed special characters in command line");
  }
  const getPath = (_path: string) => _path;

  return [getPath(executable), funcArgs, "-o", getPath(fiftOutFile), commandLine]
    .filter((c) => c)
    .join(" ");
}

async function compileFuncToCodeHash(
  funcCompiler: FUNC_COMPILER_VERSION,
  funcArgs: string,
  commandLine: string,
  tmpDir: string,
) {
  const fiftOutFile = "output.fif";
  const executable = funcCompilers[funcCompiler];
  const funcCmd = prepareFuncCommand(executable, funcArgs, fiftOutFile, commandLine);

  const { stderr } = await execAsync(funcCmd, { cwd: tmpDir });
  if (stderr) {
    throw new Error(stderr);
  }

  const codeCell = await fiftToCodeCell(fiftOutFile, tmpDir);

  return {
    hash: codeCell.hash().toString("base64"),
    funcCmd,
  };
}

async function fiftToCodeCell(fiftFile: string, tmpDir: string) {
  const b64OutFile = `${fiftFile}-b64.cell`;

  const fiftCellSource = `"${fiftFile}" include \n
boc>B "${b64OutFile}" B>file`;

  const tmpB64Fift = path.join(tmpDir, `${randomStr(10)}.cell.tmp.fif`);
  await writeFile(tmpB64Fift, fiftCellSource);

  await execAsync(`fift -s ${tmpB64Fift}`);
  // await unlink(fiftCellSource);
  // await unlink(fiftOutFile);

  const codeCellHex = Cell.fromBoc(await readFile(b64OutFile))[0];
  return codeCellHex;
}

export class FuncSourceVerifier implements SourceVerifier {
  // TODO!
  async verify(payload: SourceVerifyPayload): Promise<CompileResult> {
    let funcCmd: string | null = null;

    try {
      const { hash: codeCellHash, funcCmd: _funcCmd } = await compileFuncToCodeHash(
        payload.version,
        "",
        payload.commandLine,
        payload.tmpDir,
      );

      funcCmd = _funcCmd;

      return {
        hash: codeCellHash,
        result: codeCellHash === payload.knownContractHash ? "similar" : "not_similar",
        error: null,
        funcCmd,
      };
    } catch (e) {
      return {
        result: "unknown_error",
        error: e.toString(),
        hash: null,
        funcCmd,
      };
    }
  }
}
