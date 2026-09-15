import { ToContent } from "ipfs-core-types/src/utils";

// This can be a trivial URL, a firebase key, IPFS hash etc.
export type CodeLocationPointer = string;

export type FileUploadSpec = {
  path: string;
  name: string;
};

export interface CodeStorageProvider {
  write(files: FileUploadSpec[], pin: boolean): Promise<CodeLocationPointer[]>;
  writeFromContent(files: ToContent[], pin: boolean): Promise<CodeLocationPointer[]>;
  hashForContent(content: ToContent[]): Promise<string[]>;
  // Returns URL
  read(pointer: CodeLocationPointer): Promise<string>;
}
