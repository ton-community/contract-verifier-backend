import { Controller } from "../src/controller";
import { CodeStorageProvider, FileUploadSpec } from "../src/ipfs-code-storage-provider";
// @ts-ignore
import { of as ipfsHash } from "ipfs-only-hash";
import tweetnacl from "tweetnacl";
import { CompileResult, SourceVerifier, SourceVerifyPayload } from "../src/types";

class StubCodeStorageProvider implements CodeStorageProvider {
  storage: Map<string, string> = new Map();

  async write(...files: FileUploadSpec[]): Promise<string[]> {
    throw new Error("Method not implemented.");
  }

  async writeFromContent(...files: Buffer[]): Promise<string[]> {
    throw new Error("Method not implemented.");
  }

  async read(pointer: string): Promise<string> {
    throw new Error("Method not implemented.");
  }
}

class StubSourceVerifier implements SourceVerifier {
  async verify(payload: SourceVerifyPayload): Promise<CompileResult> {
    return {};
  }
}

describe("Controller", () => {
  describe("Sign", () => {
    let controller: Controller;

    beforeEach(() => {
      controller = new Controller(new StubCodeStorageProvider(), {
        privateKey: Buffer.from(tweetnacl.sign.keyPair().secretKey).toString("base64"),
        allowReverification: false,
        sourcesRegistryAddress: "N?A",
        verifierId: "N?A",
      });
    });

    it("does smth", async () => {
      const thingy = await controller.addSource({
        compiler: "func",
        compilerSettings: {
          funcVersion: "0.3.0",
          commandLine: "", // TODO why is this mandatory
        },
        knownContractAddress: "N/A",
        knownContractHash: "SomeHASH", // TODO this should be validated
        senderAddress: "NOPE", // TODO should be validated to + in the original func
        sources: [],
        tmpDir: "N/A", // TODO
      });
      console.log(thingy);
    });
  });
});
