import { Controller, FORWARD_MESSAGE_OP, DEPLOY_SOURCE_OP } from "../src/controller";
import { CodeStorageProvider, FileUploadSpec } from "../src/ipfs-code-storage-provider";
// @ts-ignore
import { of as ipfsHash } from "ipfs-only-hash";
import tweetnacl from "tweetnacl";
import { CompileResult, SourceVerifier, SourceVerifyPayload } from "../src/types";
import { beginCell, Cell, Address } from "ton";
import { TonReaderClient, VerifierConfig } from "../src/ton-reader-client";
import { sha256 } from "../src/utils";
import Prando from "prando";

function randomAddress(seed: string, workchain: number = 0) {
  const random = new Prando(seed);
  const hash = Buffer.alloc(32);
  for (let i = 0; i < hash.length; i++) {
    hash[i] = random.nextInt(0, 255);
  }
  return new Address(workchain, hash);
}
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
  async getVerifierConfig(
    verifierId: string,
    verifierRegistryAddress: string,
  ): Promise<VerifierConfig> {
    return {
      quorum: 1,
      verifiers: ["X"],
    };
  }
  async isProofDeployed(
    codeCellHash: string,
    sourcesRegistryAddress: string,
    verifierId: string,
  ): Promise<boolean | undefined> {
    return false;
  }
}

describe("Controller", () => {
  let controller: Controller;
  const VERIFIER_ID = "some verifier";

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
        sourcesRegistryAddress: randomAddress("sourcesReg").toFriendly(),
        verifierId: VERIFIER_ID,
        verifierRegistryAddress: randomAddress("verifierReg").toFriendly(),
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
      senderAddress: randomAddress("sender").toFriendly(), // TODO should be validated to + in the original func
      sources: [],
      tmpDir: "N/A", // TODO
    });

    expect(result.compileResult.hash).toEqual("SomeHASH");
  });

  describe("Sign", () => {
    it("Signs a source", async () => {
      const { msgCell } = await controller.addSource({
        compiler: "func",
        compilerSettings: {
          funcVersion: "0.3.0",
          commandLine: "", // TODO why is this mandatory
        },
        knownContractAddress: "N/A",
        knownContractHash: "SomeHASH", // TODO this should be validated
        senderAddress: randomAddress("sender").toFriendly(), // TODO should be validated to + in the original func
        sources: [],
        tmpDir: "N/A", // TODO
      });

      const result = await controller.sign({ messageCell: msgCell! });

      /*
        Criteria for sigining:
        - message cell is a valid cell and in the correct format
        - signature in message cell has not expired
        - signature in message cell belongs to a key from this verifier's config
        - message cell is not already signed by this verifier
        - sources do not result in the code hash
        */
    });

    describe("Invalid wrapper cell", () => {
      Object.entries({
        "invalid op": {
          cell: beginCell()
            .storeUint(1, 32)
            .storeUint(0, 64)
            .storeRef(new Cell())
            .storeRef(new Cell())
            .endCell()
            .toBoc(),
          error: "Invalid operation",
        },
        "no query id": {
          cell: beginCell()
            .storeUint(FORWARD_MESSAGE_OP, 32)
            .storeRef(new Cell())
            .storeRef(new Cell())
            .endCell()
            .toBoc(),
          error: "Invalid cell",
        },
        "no refs": {
          cell: beginCell().storeUint(1, 32).storeUint(0, 64).endCell().toBoc(),
          error: "Invalid cell",
        },
        "empty cell": {
          cell: new Cell().toBoc(),
          error: "Invalid cell",
        },
      }).map(([name, config]) => {
        const { error, cell } = config;
        it(`Rejects: ${name}`, async () => {
          await expect(controller.sign({ messageCell: cell })).rejects.toThrow(error);
        });
      });
    });

    describe("Invalid verifier message cell", () => {
      Object.entries({
        "different verifier id": {
          cell: beginCell()
            .storeUint(FORWARD_MESSAGE_OP, 32)
            .storeUint(0, 64)
            .storeRef(
              beginCell()
                .storeBuffer(sha256("some other verifier"))
                .storeUint(1, 32)
                .storeAddress(Address.parse(zeroAddress()))
                .storeAddress(randomAddress("sourcesReg"))
                .storeRef(new Cell())
                .endCell(),
            )
            .storeRef(new Cell())
            .endCell()
            .toBoc(),
          error: "Invalid verifier id",
        },
        expired: {
          cell: beginCell()
            .storeUint(FORWARD_MESSAGE_OP, 32)
            .storeUint(0, 64)
            .storeRef(
              beginCell()
                .storeBuffer(sha256(VERIFIER_ID))
                .storeUint(Math.floor(Date.now() / 1000) - 60 * 5, 32) // Message was valid up until 5 minutes ago
                .storeAddress(Address.parse(zeroAddress()))
                .storeAddress(randomAddress("sourcesReg"))
                .storeRef(new Cell())
                .endCell(),
            )
            .storeRef(new Cell())
            .endCell()
            .toBoc(),
          error: "Message is expired",
        },
        "invalid sources registry": {
          cell: beginCell()
            .storeUint(FORWARD_MESSAGE_OP, 32)
            .storeUint(0, 64)
            .storeRef(
              beginCell()
                .storeBuffer(sha256(VERIFIER_ID))
                .storeUint(Math.floor(Date.now() / 1000) + 60 * 5, 32)
                .storeAddress(Address.parse(zeroAddress()))
                .storeAddress(randomAddress("notSourcesReg"))
                .storeRef(new Cell())
                .endCell(),
            )
            .storeRef(new Cell())
            .endCell()
            .toBoc(),
          error: "Invalid sources registry address",
        },
        "missing ref": {
          cell: beginCell()
            .storeUint(FORWARD_MESSAGE_OP, 32)
            .storeUint(0, 64)
            .storeRef(
              beginCell()
                .storeBuffer(sha256(VERIFIER_ID))
                .storeUint(Math.floor(Date.now() / 1000) + 60 * 5, 32)
                .storeAddress(Address.parse(zeroAddress()))
                .storeAddress(randomAddress("sourcesReg"))
                .endCell(),
            )
            .storeRef(new Cell())
            .endCell()
            .toBoc(),
          error: "Invalid verifier body cell",
        },
        "missing addresses": {
          cell: beginCell()
            .storeUint(FORWARD_MESSAGE_OP, 32)
            .storeUint(0, 64)
            .storeRef(
              beginCell()
                .storeBuffer(sha256(VERIFIER_ID))
                .storeUint(Math.floor(Date.now() / 1000) + 60 * 5, 32)
                .storeRef(new Cell())
                .endCell(),
            )
            .storeRef(new Cell())
            .endCell()
            .toBoc(),
          error: "Invalid verifier body cell",
        },
      }).map(([name, config]) => {
        const { error, cell } = config;
        it(`Rejects: ${name}`, async () => {
          await expect(controller.sign({ messageCell: cell })).rejects.toThrow(error);
        });
      });
    });

    describe("Invalid sources registry message", () => {
      const validWrappingCell = (sourceRegCell: Cell) =>
        beginCell()
          .storeUint(FORWARD_MESSAGE_OP, 32)
          .storeUint(0, 64)
          .storeRef(
            beginCell()
              .storeBuffer(sha256(VERIFIER_ID))
              .storeUint(Math.floor(Date.now() / 1000) + 60 * 5, 32)
              .storeAddress(Address.parse(zeroAddress()))
              .storeAddress(randomAddress("sourcesReg"))
              .storeRef(sourceRegCell)
              .endCell(),
          )
          .storeRef(new Cell())
          .endCell();

      Object.entries({
        "empty cell": {
          cell: validWrappingCell(new Cell()).toBoc(),
          error: "Invalid sources registry body cell",
        },
        "missing ref": {
          cell: validWrappingCell(
            beginCell()
              .storeUint(1, 32)
              .storeUint(0, 64)
              .storeUint(0, 256)
              .storeUint(0, 256)
              .endCell(),
          ).toBoc(),
          error: "Invalid sources registry body cell",
        },
        "invalid op": {
          cell: validWrappingCell(
            beginCell()
              .storeUint(1, 32)
              .storeUint(0, 64)
              .storeBuffer(sha256(VERIFIER_ID))
              .storeUint(0, 256)
              .storeRef(new Cell())
              .endCell(),
          ).toBoc(),
          error: "Invalid deploy source op",
        },
        "invalid verified id": {
          cell: validWrappingCell(
            beginCell()
              .storeUint(DEPLOY_SOURCE_OP, 32)
              .storeUint(0, 64)
              .storeBuffer(sha256("not verifier id"))
              .storeUint(0, 256)
              .storeRef(new Cell())
              .endCell(),
          ).toBoc(),
          error: "Invalid verifier id",
        },
      }).map(([name, config]) => {
        const { error, cell } = config;
        it(`Rejects: ${name}`, async () => {
          await expect(controller.sign({ messageCell: cell })).rejects.toThrow(error);
        });
      });
    });

    // describe("Invalid signatures", () => {
    //   it("Invalid signature", async () => {
    //     throw "Not implemented";
    //   });
    //   it("My own sig", async () => {
    //     throw "Not implemented";
    //   });
    //   it("Sig does not belong to verifier id", async () => {
    //     throw "Not implemented";
    //   });
    //   it("Only one in quorum", async () => {});
    // });

    // describe("Invalid compilation results", () => {
    //   it("Different code hash", async () => {
    //     throw "Not implemented";
    //   });
    //   it("Does not compile", async () => {
    //     throw "Not implemented";
    //   });
    // });
  });
});

function zeroAddress(): string {
  return "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";
}
