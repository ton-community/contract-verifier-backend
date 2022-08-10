import { CodeLocationPointer } from "../code/code-storage-provider";
import { Base64URL } from "../../controller";

export type CompileOptions = {
  compiler: "func";
  version: "0.0.9" | "0.1.0" | "0.2.0";
  compileCommandLine: string | null;
};

export type DBSource = CompileOptions & {
  sources: {
    codeLocationPointer: CodeLocationPointer;
    originalFilename: string;
    includeInCompile: boolean;
    isEntrypoint: boolean;
    isStdLib: boolean;
    hasIncludeDirectives: boolean;
  }[];
  knownContractAddress: string;
  verificationDate: number;
  hash: Hash;
};

export type ReturnedSource = CompileOptions & {
  sources: { url: URL; originalFilename: string }[];
  knownContractAddress: string;
  verificationDate: number;
  hash: Hash;
};

type URL = string;
type Hash = string;

export interface SourcesDB {
  get(hash: Base64URL): Promise<DBSource | undefined>;
  add(source: DBSource): Promise<void>;
}
