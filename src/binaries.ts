import { FuncCompilerVersion } from "./types";

export const funcCompilers: { [key in FuncCompilerVersion]: string } = {
  "0.2.0": "resources/binaries/0.2.0",
  "0.3.0": "resources/binaries/0.3.0",
};
