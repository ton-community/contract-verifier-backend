import { promisify } from "util";
import { exec } from "child_process";
const execAsync = promisify(exec);
import { readFile, writeFile } from "fs/promises";
import { Cell } from "ton";
import { SourceToVerify } from "./source-verifier";
import {
  FUNC_COMPILER_VERSION,
  SourceVerifier,
  SourceVerifyPayload,
  VerifyResult,
} from "./source-verifier";
import path from "path";

function randomStr(length: number) {
  let result = "";
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

const funcCompilers: { [key in FUNC_COMPILER_VERSION]: string } = {
  "0.0.9": "./binaries/func.0.0.9", // [ Commit: 9875f02ef4ceba5b065d5e63c920f91aec73224e, Date: 2021-11-08 00:10:10 +0300]
  "0.1.0": "./binaries/func.0.1.0", //  [ Commit: 5b9345263efdb78a9723c4f11409eced14912a71, Date: 2021-12-28 14:41:44 +0200]
  "0.2.0": "./binaries/func.0.2.0", // [ Commit: db3619ed310484fcfa4e3565be8e10458f9f2f5f, Date: 2022-05-17 15:56:31 +0300]
};

async function compileFuncToCodeHash(
  funcCompiler: FUNC_COMPILER_VERSION,
  funcArgs: string,
  funcFiles: SourceToVerify[],
  tmpDir: string
) {
  const out = randomStr(10);
  const fiftOutFile = path.join(tmpDir, `${out}.fif`);
  const executable = funcCompilers[funcCompiler];
  const funcCmd = `${executable} ${funcArgs} -o ${fiftOutFile} -SPA ${funcFiles
    .filter((f) => f.includeInCompile)
    .map((f) => f.path)
    .join(" ")}`;

  await execAsync(funcCmd);
  const codeCell = await fiftToCodeCell(fiftOutFile, tmpDir);
  console.log({ funcCmd, codeHash: codeCell.hash().toString("base64") });

  return codeCell.hash().toString("base64");
}

async function fiftToCodeCell(fiftFile: string, tmpDir: string) {
  const b64OutFile = `${fiftFile}-b64.cell`;

  const fiftCellSource = `"${fiftFile}" include \n
boc>B "${b64OutFile}" B>file`;

  const tmpB64Fift = path.join(tmpDir, `${randomStr(10)}.cell.tmp.fif`);
  try {
    await writeFile(tmpB64Fift, fiftCellSource);
  } catch (e) {
    console.log(e);
  }

  await execAsync(`fift -s ${tmpB64Fift}`);
  // await unlink(fiftCellSource);
  // await unlink(fiftOutFile);

  const codeCellHex = Cell.fromBoc(await readFile(b64OutFile))[0];
  return codeCellHex;
}

export class FuncSourceVerifier implements SourceVerifier {
  // TODO!
  async verify(payload: SourceVerifyPayload): Promise<VerifyResult> {
    console.log(payload);

    try {
      const codeCellHash = await compileFuncToCodeHash(
        payload.version,
        "",
        payload.sources,
        payload.tmpDir
      );

      return {
        hash: codeCellHash,
        result:
          codeCellHash === payload.knownContractHash
            ? "similar"
            : "not_similar",
        error: null,
      };
    } catch (e) {
      return { result: "unknown_error", error: e.toString(), hash: null };
    }
  }
}
