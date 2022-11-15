import { promisify } from "util";
import { exec } from "child_process";
const execAsync = promisify(exec);
import { readFile, writeFile, readdir } from "fs/promises";
import { Cell } from "ton";
import {
  FuncCompilerVersion,
  SourceVerifier,
  SourceVerifyPayload,
  CompileResult,
  UserProvidedFuncCompileSettings,
} from "./types";
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

const funcCompilers: { [key in FuncCompilerVersion]: string } = {
  "0.2.0": "resources/binaries/0.2.0",
  "0.3.0": "resources/binaries/0.3.0",
};

const fiftlibVersion = "d46e4b35387a12a08a48be4b2bb7b52865c34f00";

const fiftVersions: { [key in FuncCompilerVersion]: string } = {
  "0.2.0": "a9ba27382c7f25618323356b9f408281c6c27704",
  "0.3.0": "20758d6bdd0c1327091287e8a620f660d1a9f4da",
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

function funcCommandForDisplay(cmd: string): string {
  return /\/(func.*)/.exec(cmd)![1];
}

async function compileFuncToCodeHash(
  funcVersion: FuncCompilerVersion,
  funcArgs: string,
  commandLine: string,
  tmpDir: string,
) {
  const fiftOutFile = "output.fif";
  const executable = path.join(process.cwd(), funcCompilers[funcVersion], "func");
  const funcCmd = prepareFuncCommand(executable, funcArgs, fiftOutFile, commandLine);

  const { stderr } = await execAsync(funcCmd, { cwd: tmpDir });
  if (stderr) {
    throw new Error(stderr);
  }

  const codeCell = await fiftToCodeCell(funcVersion, fiftOutFile, tmpDir);

  return {
    hash: codeCell.hash().toString("base64"),
    funcCmd: funcCommandForDisplay(funcCmd),
  };
}

async function fiftToCodeCell(funcVersion: FuncCompilerVersion, fiftFile: string, tmpDir: string) {
  const b64OutFile = `${fiftFile}-b64.cell`;

  const fiftCellSource = `"${fiftFile}" include \n
boc>B "${b64OutFile}" B>file`;

  const tmpB64Fift = path.join(tmpDir, `${randomStr(10)}.cell.tmp.fif`);
  await writeFile(tmpB64Fift, fiftCellSource);

  const executable = path.join(process.cwd(), funcCompilers[funcVersion], "fift");

  process.env.FIFTPATH = path.join(process.cwd(), "resources", "fiftlib");

  await execAsync(`${executable} -s ${tmpB64Fift}`);

  return Cell.fromBoc(await readFile(b64OutFile))[0];
}

export class FuncSourceVerifier implements SourceVerifier {
  async verify(payload: SourceVerifyPayload): Promise<CompileResult> {
    let funcCmd: string | null = null;
    const compilerSettings = payload.compilerSettings as UserProvidedFuncCompileSettings;

    try {
      const { hash: codeCellHash, funcCmd: _funcCmd } = await compileFuncToCodeHash(
        compilerSettings.funcVersion,
        "",
        compilerSettings.commandLine,
        payload.tmpDir,
      );

      funcCmd = _funcCmd;

      return {
        hash: codeCellHash,
        result: codeCellHash === payload.knownContractHash ? "similar" : "not_similar",
        error: null,
        compilerSettings: {
          funcVersion: compilerSettings.funcVersion,
          commandLine: funcCmd,
          fiftlibVersion,
          fiftVersion: fiftVersions[compilerSettings.funcVersion],
        },
      };
    } catch (e) {
      return {
        result: "unknown_error",
        error: e.toString(),
        hash: null,
        compilerSettings: {
          funcVersion: compilerSettings.funcVersion,
          commandLine: funcCmd ?? "",
          fiftlibVersion,
          fiftVersion: fiftVersions[compilerSettings.funcVersion],
        },
      };
    }
  }
}
