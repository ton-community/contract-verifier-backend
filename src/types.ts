export type Compiler = "func" | "fift";

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

export type UserProvidedFuncCompileSettings = {
  funcVersion: FuncCompilerVersion;
  commandLine: string;
};

export type FuncCliCompileSettings = UserProvidedFuncCompileSettings & {
  fiftVersion: string;
  fiftlibVersion: string;
};

export type FiftCliCompileSettings = {
  fiftVersion: string;
  fiftlibVersion: string;
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

export type CompileResult = {
  result: "similar" | "not_similar" | "compile_error" | "unknown_error";
  error: string | null;
  hash: string | null;
  compilerSettings: FuncCliCompileSettings | FiftCliCompileSettings;
  sources: (FuncSourceCompileResult | FiftSourceCompileResult)[];
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
  compilerSettings: UserProvidedFuncCompileSettings;
};

export type SourceVerifyPayload = CompileOptions & {
  sources: SourceToVerify[];
  knownContractAddress: string;
  knownContractHash: string;
  tmpDir: string;
  senderAddress: string;
};
