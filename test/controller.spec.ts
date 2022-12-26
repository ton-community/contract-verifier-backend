import { Controller } from "../src/controller";
import { CodeStorageProvider, FileUploadSpec } from "../src/ipfs-code-storage-provider";
// @ts-ignore
import { of as ipfsHash } from "ipfs-only-hash";
import tweetnacl from "tweetnacl";
import { CompileResult, SourceVerifier, SourceVerifyPayload } from "../src/types";
import { stubObject } from "ts-sinon";
import { TonClient } from "ton";
import { TonReaderClient } from "../src/is-proof-deployed";

class StubCodeStorageProvider implements CodeStorageProvider {
  storage: Map<string, string> = new Map();

  async write(...files: FileUploadSpec[]): Promise<string[]> {
    return Promise.all(files.map((file) => ipfsHash(file.name)));
  }

  async writeFromContent(...files: Buffer[]): Promise<string[]> {
    return Promise.all(files.map((file) => ipfsHash(file)));
  }

  async read(pointer: string): Promise<string> {
    throw new Error("Method not implemented.");
  }
}

class StubSourceVerifier implements SourceVerifier {
  async verify(payload: SourceVerifyPayload): Promise<CompileResult> {
    return {
      result: "similar",
      error: null,
      compilerSettings: {
        funcVersion: "0.3.0",
        commandLine: "some command line",
      },
      hash: "SomeHASH",
      sources: [],
    };
  }
}

class StubTonReaderClient implements TonReaderClient {
  async isProofDeployed(
    codeCellHash: string,
    sourcesRegistryAddress: string,
    verifierId: string,
  ): Promise<boolean | undefined> {
    return false;
  }
}

describe("Controller", () => {
  describe("Sign", () => {
    let controller: Controller;

    beforeEach(() => {
      controller = new Controller(
        new StubCodeStorageProvider(),
        {
          func: new StubSourceVerifier(),
          fift: new StubSourceVerifier(),
          tact: new StubSourceVerifier(),
        },
        {
          privateKey: Buffer.from(tweetnacl.sign.keyPair().secretKey).toString("base64"),
          allowReverification: false,
          sourcesRegistryAddress: zeroAddress(),
          verifierId: "N?A",
        },
        new StubTonReaderClient(),
      );
    });

    it("Adds source", async () => {
      const result = await controller.addSource({
        compiler: "func",
        compilerSettings: {
          funcVersion: "0.3.0",
          commandLine: "", // TODO why is this mandatory
        },
        knownContractAddress: "N/A",
        knownContractHash: "SomeHASH", // TODO this should be validated
        senderAddress: zeroAddress(), // TODO should be validated to + in the original func
        sources: [],
        tmpDir: "N/A", // TODO
      });

      expect(result.compileResult.hash).toEqual("SomeHASH");
      expect(result.ipfsLink).toEqual("QmdNixXYcNCMoKJxrT4qhoCsXEhNA8YcHGHfhx9mHu8T8p");
    });
  });
});

function zeroAddress(): string {
  return "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";
}
