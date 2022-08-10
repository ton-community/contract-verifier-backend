
// This can be a trivial URL, a firebase key, IPFS hash etc.
export type CodeLocationPointer = string;

export type FileUploadSpec = {
  path: string;
  name: string;
};

export interface CodeStorageProvider {
  write(...files: FileUploadSpec[]): Promise<CodeLocationPointer[]>;
  // Returns URL
  read(pointer: CodeLocationPointer): Promise<string>;
}
