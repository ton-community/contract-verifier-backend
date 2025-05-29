export type Compiler = "func" | "fift" | "tolk" | "tact";

import { FuncCompilerVersion } from "@ton-community/contract-verifier-sdk";

export interface SourceVerifier {
  verify(payload: SourceVerifyPayload): Promise<CompileResult>;
}

export type VerifyResult = {
  compileResult: CompileResult;
  sig?: string;
  ipfsLink?: string;
  msgCell?: Buffer;
};

export type FuncCliCompileSettings = {
  funcVersion: FuncCompilerVersion;
  commandLine: string;
};

export type FiftCliCompileSettings = {
  fiftVersion: string;
  commandLine: string;
};

export type TolkCliCompileSettings = {
  tolkVersion: string;
};

export type TactCliCompileSettings = {};

export type FuncSourceCompileResult = {
  includeInCommand: boolean;
  isEntrypoint: boolean;
  isStdLib: boolean;
  hasIncludeDirectives: boolean;
  filename: string;
};

export type FiftSourceCompileResult = {
  filename: string;
};

export type TolkSourceCompileResult = {
  filename: string;
};

export type TactSourceCompileResult = {
  filename: string;
};

export type CompileResult = {
  result: "similar" | "not_similar" | "compile_error" | "unknown_error";
  error: string | null;
  hash: string | null;
  compilerSettings:
    | FuncCliCompileSettings
    | FiftCliCompileSettings
    | TolkCliCompileSettings
    | TactCliCompileSettings;
  sources: (
    | FuncSourceCompileResult
    | FiftSourceCompileResult
    | TolkSourceCompileResult
    | TactSourceCompileResult
  )[];
};

type Path = string;

export type SourceToVerify = {
  path: Path;
};

export type FuncSourceToVerify = SourceToVerify & {
  // TODO - these will be removed and done exclusively on the backend
  includeInCommand: boolean;
  isEntrypoint: boolean;
  isStdLib: boolean;
  hasIncludeDirectives: boolean;
};

export type TolkSourceToVerify = SourceToVerify & {
  isEntrypoint: boolean;
};

export type CompileOptions = {
  compiler: Compiler;
  compilerSettings:
    | FuncCliCompileSettings
    | FiftCliCompileSettings
    | TolkCliCompileSettings
    | TactCliCompileSettings;
};

export type SourceVerifyPayload = CompileOptions & {
  sources: SourceToVerify[];
  knownContractAddress: string;
  knownContractHash: string;
  tmpDir: string;
  senderAddress: string;
};

export type SourceItem = {
  compilerSettings: FuncCliCompileSettings | FiftCliCompileSettings | TactCliCompileSettings;
  compiler: Compiler;
  hash: string;
  verificationDate: number;
  sources: ({
    url: string;
  } & (
    | FuncSourceCompileResult
    | TactSourceCompileResult
    | TolkSourceCompileResult
    | FiftSourceCompileResult
  ))[];
  knownContractAddress: string;
};
