export type Compiler = "cli:func" | "npm:ton-compiler";

export type FuncCliCompilerVersion = "0.2.0" | "0.3.0";

export interface SourceVerifier {
  verify(payload: SourceVerifyPayload): Promise<CompileResult>;
}

export type VerifyResult = {
  compileResult: CompileResult;
  sig?: string;
  ipfsLink?: string;
  msgCell?: Buffer;
};

export type UserProvidedFuncCliCompileSettings = {
  funcVersion: FuncCliCompilerVersion;
  commandLine: string;
};

export type FuncCliCompileSettings = UserProvidedFuncCliCompileSettings & {
  fiftVersion: string;
  fiftlibVersion: string;
};

export type UserProvidedNpmTonCompilerSettings = {
  version: "v2022.10" | "legacy";
};

export type NpmTonCompilerSettings = UserProvidedNpmTonCompilerSettings & {
  npmVersion: "2.0.0";
};

export type CompileResult = {
  result: "similar" | "not_similar" | "compile_error" | "unknown_error";
  error: string | null;
  hash: string | null;
  compilerSettings: FuncCliCompileSettings | NpmTonCompilerSettings;
};

type Path = string;

export type SourceToVerify = {
  path: Path;
  includeInCommand: boolean;
  isEntrypoint: boolean;
  isStdLib: boolean;
  hasIncludeDirectives: boolean;
};

export type CompileOptions = {
  compiler: Compiler;
  compilerSettings: UserProvidedFuncCliCompileSettings | UserProvidedNpmTonCompilerSettings;
};

export type SourceVerifyPayload = CompileOptions & {
  sources: SourceToVerify[];
  knownContractAddress: string;
  knownContractHash: string;
  tmpDir: string;
  senderAddress: string;
};
