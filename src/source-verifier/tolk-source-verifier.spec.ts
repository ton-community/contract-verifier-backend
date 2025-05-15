import path from "path";
import { TolkSourceVerifier } from "./tolk-source-verifier";
import { mkdtemp, writeFile } from "fs/promises";
import os from "os";
import { randomBytes } from "tweetnacl";
import { TolkSourceToVerify } from "../types";
import { mkdir } from "fs/promises";
import { readFileSync } from "fs";

const counterData = `
const OP_INCREASE = 0x7e8764ef;  // arbitrary 32-bit number, equal to OP_INCREASE in wrappers/CounterContract.ts

// storage variables

// id is required to be able to create different instances of counters
// since addresses in TON depend on the initial state of the contract
global ctxID: int;
global ctxCounter: int;

// loadData populates storage variables from persistent storage
fun loadData() {
    var ds = contract.getData().beginParse();

    ctxID = ds.loadUint(32);
    ctxCounter = ds.loadUint(32);

    ds.assertEnd();
}

// saveData stores storage variables as a cell into persistent storage
fun saveData() {
    contract.setData(
        beginCell()
        .storeUint(ctxID, 32)
        .storeUint(ctxCounter, 32)
        .endCell()
    );
}`;

const counterMain = `
// onInternalMessage is the main entrypoint; it's called when a contract receives an internal message from other contracts
fun onInternalMessage(myBalance: int, msgValue: int, msgFull: cell, msgBody: slice) {
    if (msgBody.isEnd()) { // ignore all empty messages
        return;
    }

    var cs: slice = msgFull.beginParse();
    val flags = cs.loadMessageFlags();
    if (isMessageBounced(flags)) { // ignore all bounced messages
        return;
    }

    loadData(); // here we populate the storage variables

    val op = msgBody.loadMessageOp(); // by convention, the first 32 bits of incoming message is the op
    val queryID = msgBody.loadMessageQueryId(); // also by convention, the next 64 bits contain the "query id", although this is not always the case

    if (op == OP_INCREASE) {
        val increaseBy = msgBody.loadUint(32);
        ctxCounter += increaseBy;
        saveData();
        return;
    }

    throw 0xffff; // if the message contains an op that is not known to this contract, we throw
}`;

const counterGetters = `
// get methods are a means to conveniently read contract data using, for example, HTTP APIs
// note that unlike in many other smart contract VMs, get methods cannot be called by other contracts

get currentCounter(): int {
    loadData();
    return ctxCounter;
}

get initialId(): int {
    loadData();
    return ctxID;
}`;

describe("Tolk source verifier", () => {
  let tolkVersions = ["0.12.0"];

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
      const runTolkCompiler = (await import(`tolk-${tolkVersion}`)).runTolkCompiler;
      expect(runTolkCompiler).not.toBeUndefined();

      const compileRes = await runTolkCompiler({
        entrypointFileName: sourceName,
        fsReadCallback: (path: string) => testSource,
      });
      if (compileRes.status !== "ok") {
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

      expect(verifyRes.result == "similar").toBe(true);
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
      const runTolkCompiler = (await import(`tolk-${tolkVersion}`)).runTolkCompiler;
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

      expect(verifyRes.result == "similar").toBe(true);
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
      const runTolkCompiler = (await import(`tolk-${tolkVersion}`)).runTolkCompiler;
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
      const runTolkCompiler = (await import(`tolk-${tolkVersion}`)).runTolkCompiler;
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

      expect(verifyRes.result == "similar").toBe(true);
      expect(verifyRes.hash).toEqual(resHash);
    }
  });

  it("verifier should handle multiple files scenario with default readFile callback", async () => {
    const mainSource = `
        import "import/data.tolk";
        import "import/getters.tolk";

        ${counterMain}`;
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
      const runTolkCompiler = (await import(`tolk-${tolkVersion}`)).runTolkCompiler;
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

      expect(verifyRes.result == "similar").toBe(true);
      expect(verifyRes.hash).toEqual(resHash);
    }
  });
});
