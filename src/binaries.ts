import { FuncCompilerVersion } from "@ton-community/contract-verifier-sdk";

export const funcCompilers: { [key in FuncCompilerVersion]: string } = {
  "0.2.0": "resources/binaries/0.2.0",
  "0.3.0": "resources/binaries/0.3.0",
  "0.4.0": "resources/binaries/0.4.0",
  "0.4.1": "resources/binaries/0.4.1",
};
