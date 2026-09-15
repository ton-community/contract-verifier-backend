import { promisify } from "util";
import { exec } from "child_process";
const execAsync = promisify(exec);
import { readFile, writeFile } from "fs/promises";
import { CompileResult, SourceVerifier, SourceVerifyPayload } from "../types";
import path from "path";
import { Cell } from "@ton/core";
import { FuncCompilerVersion } from "../types";
import { binaryPath } from "../binaries";
import { getLogger } from "../logger";

const logger = getLogger("fift-source-verifier");

export const specialCharsRegex = () => /[;>\&`\|\$\(\)\[\]\{\}'"\\\#]/;

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

  const executable = path.join(process.cwd(), binaryPath, funcVersion, "fift");

  if (specialCharsRegex().test(executable)) {
    throw new Error("Unallowed special characters in command line");
  }

  process.env.FIFTPATH = path.join(process.cwd(), binaryPath, funcVersion, "fiftlib");

  await execAsync(`${executable} -s ${tmpB64Fift}`);

  return Cell.fromBoc(await readFile(b64OutFile))[0];
}

export class FiftSourceVerifier implements SourceVerifier {
  async verify(payload: SourceVerifyPayload): Promise<CompileResult> {
    logger.info("Starting Fift verification", {
      sourcesCount: payload.sources.length,
    });

    const funcVersion: FuncCompilerVersion = "0.4.1"; // Single version, assuming fift doesn't affect code hash
    const sources = payload.sources.map((s) => ({ filename: s.path }));

    try {
      if (!process.env.ALLOW_FIFT) {
        logger.warn("Fift verification attempted but ALLOW_FIFT is not set");
        throw new Error("Fift is disabled");
      }
      if (payload.sources.length !== 1) {
        logger.error("Invalid sources count for Fift", {
          sourcesCount: payload.sources.length,
        });
        throw new Error("Only one source file is allowed for fift verification");
      }

      logger.debug("Converting Fift to code cell", {
        fiftFile: payload.sources[0].path,
        funcVersion,
      });
      const cell = await fiftToCodeCell(funcVersion, payload.sources[0].path, payload.tmpDir);
      const hash = cell.hash().toString("base64");
      const result = hash === payload.knownContractHash ? "similar" : "not_similar";

      logger.info("Fift verification completed", {
        hash,
        result,
        matches: result === "similar",
      });

      return {
        hash,
        result,
        error: null,
        compilerSettings: {
          fiftVersion: funcVersion, // Fift is tied to a FunC version
          commandLine: `echo '"${payload.sources[0].path}" include\nboc>B "output.cell" B>file' | fift`,
        },
        sources,
      };
    } catch (e) {
      logger.error("Fift verification error", { error: e.toString() });
      return {
        hash: null,
        result: "unknown_error",
        error: e.toString(),
        compilerSettings: {
          fiftVersion: funcVersion,
          commandLine: "",
        },
        sources,
      };
    }
  }
}
