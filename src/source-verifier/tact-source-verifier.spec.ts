import { TactSourceVerifier } from "./tact-source-verifier";
describe("TactSourceVerifier", () => {
  it("compiles", async function () {
    const tactVerifier = new TactSourceVerifier();

    const res = await tactVerifier.verify({
      compiler: "tact",
      compilerSettings: { tactVersion: "0.5.0" },
      knownContractAddress: "",
      knownContractHash: "htGkXV77gc/Tx5Z55tyTyZT8aSpmpnpkFPZpe4lPMIQ=",
      senderAddress: "",
      sources: [
        {
          path: "src/source-verifier/main.tact",
        },
      ],
      tmpDir: "",
    });

    console.log(res);
  });
});
