import { Readable } from "stream";
import { CompileOptions } from "../storage/db/source-db-provider";

export type FUNC_COMPILER_VERSION = "0.0.9" | "0.1.0" | "0.2.0";

export interface SourceVerifier {
  verify(payload: SourceVerifyPayload): Promise<VerifyResult>;
}

export type VerifyResult = {
  result: "similar" | "not_similar" | "compile_error" | "unknown_error";
  error: string | null;
  hash: string | null;
};

type Path = string;

export type SourceToVerify = {
  path: Path;
  includeInCompile: boolean;
  isEntrypoint: boolean;
  isStdLib: boolean;
  hasIncludeDirectives: boolean;
};

export type SourceVerifyPayload = CompileOptions & {
  sources: SourceToVerify[];
  knownContractAddress: string;
  knownContractHash: string;
  tmpDir: string;
};
