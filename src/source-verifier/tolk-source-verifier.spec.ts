import path from "path";
import { TolkSourceVerifier } from "./tolk-source-verifier";
import { mkdtemp, writeFile } from "fs/promises";
import os from "os";
import { randomBytes } from "tweetnacl";
import { TolkSourceToVerify } from "../types";
import { mkdir } from "fs/promises";
import { readFileSync } from "fs";
import { supportedVersionsReader } from "../supported-versions-reader";
import { DynamicImporter } from "../dynamic-importer";

const counterData = `
tolk 1.0

// this struct defines storage layout of the contract
struct Storage {
    id: uint32  // required to allow multiple independent counter instances, since the contract address depends on its initial state
    counter: uint32 // the current counter value
}
// load contract data from the persistent storage
fun Storage.load() {
    return Storage.fromCell(contract.getData())
}

// save contract data into the persistent storage
fun Storage.save(self) {
    contract.setData(self.toCell())
}

// the struct uses a 32-bit opcode prefix for message identification
struct (0x7e8764ef) IncreaseCounter {
    queryId: uint64  // query id, typically included in messages
    increaseBy: uint32
}

struct (0x3a752f06) ResetCounter {
    queryId: uint64
}
// using unions to represent available messages
// this allows processing them with pattern matching
type AllowedMessage = IncreaseCounter | ResetCounter
`;

const counterMain = `
// the main entrypoint: called when a contract receives an message from other contracts
fun onInternalMessage(in: InMessage) {
    // use lazy to defer loading fields until they are accessed
    val msg = lazy AllowedMessage.fromSlice(in.body);

    match (msg) {
        IncreaseCounter => {
            // load contract storage lazily (efficient for large or partial reads/updates)
            var storage = lazy Storage.load();

            storage.counter += msg.increaseBy;
            storage.save();
        }

        ResetCounter => {
            var storage = lazy Storage.load();

            storage.counter = 0;
            storage.save();
        }

        else => {
            // ignore empty messages, "wrong opcode" for others
            assert (in.body.isEmpty()) throw 0xFFFF
        }
    }
}

// a handler for bounced messages (not used here, may be ommited)
fun onBouncedMessage(in: InMessageBounced) {
}
`;

const counterGetters = `
// get methods are a means to conveniently read contract data using, for example, HTTP APIs
// note that unlike in many other smart contract VMs, get methods cannot be called by other contracts
get fun currentCounter(): int {
    val storage = lazy Storage.load();
    return storage.counter;
}

get fun initialId(): int {
    val storage = lazy Storage.load();
    return storage.id;
}
`;

jest.mock("../supported-versions-reader", () => ({
  supportedVersionsReader: {
    versions: jest.fn(),
  },
}));

const versionsMock = supportedVersionsReader.versions as jest.Mock;

const importTolk = async (version: string) => {
  return await DynamicImporter.tryImport("tolk", version);
};
beforeEach(() => {
  versionsMock.mockResolvedValue({
    funcVersions: [],
    tactVersions: [],
    tolkVersions: ["1.0.0", "1.1.0"],
  });
});

describe("Tolk source verifier", () => {
  let tolkVersions = ["1.0.0", "1.1.0"];

  it("tolk should compile and match expected hash", async () => {
    const sourceName = "counter.tolk";
    const testSource = counterData + counterMain + counterGetters;
    const tolkVerifier = new TolkSourceVerifier((path) => {
      if (path == sourceName) {
        return testSource;
      }
      throw new Error(`Unknown path: ${path}`);
    });

    for (let tolkVersion of tolkVersions) {
      const runTolkCompiler = (await importTolk(tolkVersion)).runTolkCompiler;
      expect(runTolkCompiler).not.toBeUndefined();

      const compileRes = await runTolkCompiler({
        entrypointFileName: sourceName,
        fsReadCallback: (path: string) => testSource,
      });
      if (compileRes.status !== "ok") {
        console.log(compileRes);
        throw "Failed to compile";
      }

      /*
            const tmpDir  = await mkdtemp(path.join(os.tmpdir(), 'tolk_test'));
            const outPath = path.join(tmpDir, sourceName);
            await writeFile(outPath, testSource, { encoding: 'utf8' });
            */

      const resHash = Buffer.from(compileRes.codeHashHex, "hex").toString("base64");

      const verifyRes = await tolkVerifier.verify({
        compiler: "tolk",
        compilerSettings: { tolkVersion: tolkVersion },
        knownContractAddress: "",
        knownContractHash: resHash,
        senderAddress: "",
        sources: [
          {
            path: sourceName,
            isEntrypoint: true,
          } as any,
        ],
        tmpDir: "",
      });

      expect(verifyRes.error).toBeNull();
      expect(verifyRes.result).toEqual("similar");
      expect(verifyRes.hash).toEqual(resHash);
    }
  });

  it("tolk should compile and match expected hash with default readFile handler", async () => {
    const sourceName = "counter.tolk";
    const testSource = counterData + counterMain + counterGetters;
    const tolkVerifier = new TolkSourceVerifier();

    // Write file to tmp dir
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "tolk_test"));
    const outPath = path.join(tmpDir, sourceName);
    await writeFile(outPath, testSource, { encoding: "utf8" });

    for (let tolkVersion of tolkVersions) {
      const runTolkCompiler = (await importTolk(tolkVersion)).runTolkCompiler;
      expect(runTolkCompiler).not.toBeUndefined();

      const compileRes = await runTolkCompiler({
        entrypointFileName: sourceName,
        fsReadCallback: (path: string) => testSource,
      });
      if (compileRes.status !== "ok") {
        throw "Failed to compile";
      }

      const resHash = Buffer.from(compileRes.codeHashHex, "hex").toString("base64");

      const verifyRes = await tolkVerifier.verify({
        compiler: "tolk",
        compilerSettings: { tolkVersion: tolkVersion },
        knownContractAddress: "",
        knownContractHash: resHash,
        senderAddress: "",
        sources: [
          {
            path: sourceName,
            isEntrypoint: true,
          } as TolkSourceToVerify,
        ],
        tmpDir,
      });

      expect(verifyRes.error).toBeNull();
      expect(verifyRes.result).toEqual("similar");
      expect(verifyRes.hash).toEqual(resHash);
    }
  });

  it("verifier should reject non-matching hash", async () => {
    const sourceName = "counter.tolk";
    const testSource = counterData + counterMain + counterGetters;
    const tolkVerifier = new TolkSourceVerifier((path) => {
      if (path == sourceName) {
        return testSource;
      }
      throw new Error(`Unknown path: ${path}`);
    });

    for (let tolkVersion of tolkVersions) {
      const runTolkCompiler = (await importTolk(tolkVersion)).runTolkCompiler;
      expect(runTolkCompiler).not.toBeUndefined();

      const compileRes = await runTolkCompiler({
        entrypointFileName: sourceName,
        fsReadCallback: (path: string) => testSource,
      });
      if (compileRes.status !== "ok") {
        throw "Failed to compile";
      }

      let resHash = Buffer.from(randomBytes(32)).toString("base64");

      const verifyRes = await tolkVerifier.verify({
        compiler: "tolk",
        compilerSettings: { tolkVersion: tolkVersion },
        knownContractAddress: "",
        knownContractHash: resHash,
        senderAddress: "",
        sources: [
          {
            path: sourceName,
            isEntrypoint: true,
          } as TolkSourceToVerify,
        ],
        tmpDir: "",
      });

      expect(verifyRes.error).toBeNull();
      expect(verifyRes.result).toBe("not_similar");
    }
  });
  it("verifier should handle multiple files scenario", async () => {
    const mainSource = `
        import "import/data.tolk";
        import "import/getters.tolk";

        ${counterMain}`;
    const gettersSource = `
        import "data.tolk";

        ${counterGetters}
        `;

    const sourceName = "counter.tolk";

    const readCb = (path: string) => {
      if (path == "import/data.tolk") {
        return counterData;
      } else if (path == "import/getters.tolk") {
        return gettersSource;
      } else if (path == sourceName) {
        return mainSource;
      }
      throw new Error(`Unknown path: ${path}`);
    };

    const tolkVerifier = new TolkSourceVerifier(readCb);

    for (let tolkVersion of tolkVersions) {
      const runTolkCompiler = (await importTolk(tolkVersion)).runTolkCompiler;
      expect(runTolkCompiler).not.toBeUndefined();

      const compileRes = await runTolkCompiler({
        entrypointFileName: sourceName,
        fsReadCallback: readCb,
      });

      if (compileRes.status !== "ok") {
        throw "Failed to compile";
      }

      const resHash = Buffer.from(compileRes.codeHashHex, "hex").toString("base64");

      const verifyRes = await tolkVerifier.verify({
        compiler: "tolk",
        compilerSettings: { tolkVersion: tolkVersion },
        knownContractAddress: "",
        knownContractHash: resHash,
        senderAddress: "",
        sources: [
          {
            path: sourceName,
            isEntrypoint: true,
          } as TolkSourceToVerify,
        ],
        tmpDir: "",
      });

      expect(verifyRes.error).toBeNull();
      expect(verifyRes.result).toEqual("similar");
      expect(verifyRes.hash).toEqual(resHash);
    }
  });

  it("verifier should handle multiple files scenario with default readFile callback", async () => {
    const mainSource = `
        import "import/data.tolk";
      import "import/getters.tolk";

        ${counterMain} `;
    const gettersSource = `
      import "data.tolk";

        ${counterGetters}
      `;

    const sourceName = "counter.tolk";

    const readCb = (path: string) => readFileSync(path, { encoding: "utf8" });

    // Write file to tmp dir
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "tolk_test_multiple"));
    await mkdir(path.join(tmpDir, "import"));
    for (let pathTuple of [
      [sourceName, mainSource],
      ["import/data.tolk", counterData],
      ["import/getters.tolk", gettersSource],
    ]) {
      const outPath = path.join(tmpDir, pathTuple[0]);
      await writeFile(outPath, pathTuple[1], { encoding: "utf8" });
    }

    const tolkVerifier = new TolkSourceVerifier(); // Default readFile handler

    for (let tolkVersion of tolkVersions) {
      const runTolkCompiler = (await importTolk(tolkVersion)).runTolkCompiler;
      expect(runTolkCompiler).not.toBeUndefined();

      const compileRes = await runTolkCompiler({
        entrypointFileName: path.join(tmpDir, sourceName),
        fsReadCallback: readCb,
      });

      if (compileRes.status !== "ok") {
        throw "Failed to compile";
      }

      const resHash = Buffer.from(compileRes.codeHashHex, "hex").toString("base64");

      const verifyRes = await tolkVerifier.verify({
        compiler: "tolk",
        compilerSettings: { tolkVersion: tolkVersion },
        knownContractAddress: "",
        knownContractHash: resHash,
        senderAddress: "",
        sources: [
          {
            path: sourceName,
            isEntrypoint: true,
          } as TolkSourceToVerify,
        ],
        tmpDir,
      });

      expect(verifyRes.error).toBeNull();
      expect(verifyRes.result).toEqual("similar");
      expect(verifyRes.hash).toEqual(resHash);
    }
  });
});
