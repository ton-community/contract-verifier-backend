import { promisify } from "util";
import { exec } from "child_process";
const execAsync = promisify(exec);
import {
  SourceVerifier,
  SourceVerifyPayload,
  CompileResult,
  FuncCliCompileSettings,
  FuncSourceToVerify,
} from "../types";
import path from "path";
import { funcCompilers } from "../binaries";
import { fiftToCodeCell } from "./fift-source-verifier";
import { FuncCompilerVersion } from "@ton-community/contract-verifier-sdk";

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

export class FuncSourceVerifier implements SourceVerifier {
  async verify(payload: SourceVerifyPayload): Promise<CompileResult> {
    let funcCmd: string | null = null;
    const compilerSettings = payload.compilerSettings as FuncCliCompileSettings;

    const sources = payload.sources.map((s: FuncSourceToVerify) => ({
      filename: s.path,
      hasIncludeDirectives: s.hasIncludeDirectives,
      isEntrypoint: s.isEntrypoint,
      isStdLib: s.isStdLib,
      includeInCommand: s.includeInCommand,
    }));

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
        },
        sources,
      };
    } catch (e) {
      return {
        result: "unknown_error",
        error: e.toString(),
        hash: null,
        compilerSettings: {
          funcVersion: compilerSettings.funcVersion,
          commandLine: funcCmd ?? "",
        },
        sources,
      };
    }
  }
}
