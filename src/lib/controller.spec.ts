import { Controller } from "./controller";
import {
  SourceVerifier,
  SourceVerifyPayload,
  VerifyResult,
} from "./compiler/source-verifier";
import {
  DBSource,
  ReturnedSource,
  SourcesDB,
} from "./storage/db/source-db-provider";
import {
  CodeStorageProvider,
  FileUploadSpec,
} from "./storage/code/code-storage-provider";
import { mock } from "jest-mock-extended";

class MockCodeStorageProvider implements CodeStorageProvider {
  async write(...files: FileUploadSpec[]): Promise<string[]> {
    return files.map(({ name }) => name);
  }
  async read(pointer: string): Promise<string> {
    return `https://mysvc.com/${pointer}`;
  }
}

class MockSourceVerifier implements SourceVerifier {
  async verify(payload: SourceVerifyPayload): Promise<VerifyResult> {
    return { result: "similar", error: undefined };
  }
}

class MockSourcesDB implements SourcesDB {
  async get(hash: string): Promise<ReturnedSource | undefined> {
    return {
      compileCommandLine: null,
      compiler: "func",
      hash: hash,
      knownContractAddress: "NA",
      sources: ["stdlib.fc", "thing.fc"],
      version: "0.2.0",
      verificationDate: 1,
    };
  }
  async add(source: DBSource): Promise<void> {
    // Do nothing
  }
}

describe("Controller", () => {
  it("does smth", async () => {
    const controller = new Controller(
      new MockCodeStorageProvider(),
      mock<SourcesDB>(),
      new MockSourceVerifier()
    );

    await controller.addSource({
      compileCommandLine: null,
      compiler: "func",
      hash: "someHash",
      knownContractAddress: "NA",
      knownContractHash: "X123",
      sources: [],
      version: "0.2.0",
    });
  });
});
