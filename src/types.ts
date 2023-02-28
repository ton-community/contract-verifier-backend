export type Compiler = "func" | "fift" | "tact";

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

export type TactCliCompileSettings = {
  tactVersion: string;
  parameters?: string | null;
};

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

export type TactSourceCompileResult = {
  filename: string;
};

export type CompileResult = {
  result: "similar" | "not_similar" | "compile_error" | "unknown_error";
  error: string | null;
  hash: string | null;
  compilerSettings: FuncCliCompileSettings | FiftCliCompileSettings | TactCliCompileSettings;
  sources: (FuncSourceCompileResult | FiftSourceCompileResult | TactSourceCompileResult)[];
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

export type CompileOptions = {
  compiler: Compiler;
  compilerSettings: FuncCliCompileSettings | FiftCliCompileSettings | TactCliCompileSettings;
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
  } & (FuncSourceCompileResult | TactSourceCompileResult | FiftSourceCompileResult))[];
  knownContractAddress: string;
};
