export type Compiler = "func" | "fift" | "tact";

export type FuncCompilerVersion = "0.2.0" | "0.3.0";

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
  tactVersion: "0.4.0";
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
  type: "code" | "abi";
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

  // TODO - these will be removed and done exclusively on the backend
  includeInCommand: boolean;
  isEntrypoint: boolean;
  isStdLib: boolean;
  hasIncludeDirectives: boolean;
};

export type CompileOptions = {
  compiler: Compiler;
  compilerSettings: FuncCliCompileSettings;
};

export type SourceVerifyPayload = CompileOptions & {
  sources: SourceToVerify[];
  knownContractAddress: string;
  knownContractHash: string;
  tmpDir: string;
  senderAddress: string;
};
