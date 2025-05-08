import { TactSourceVerifier } from "./tact-source-verifier";

import { pkg162 } from "./res/tact162pkg";
import { pkg163 } from "./res/tact163pkg";
import { pkg141 } from "./res/tact141pkg";

// TODO FIX
jest.mock("../fetch-compiler-versions", () => ({
  getSupportedVersions: jest.fn().mockResolvedValue({
    funcVersions: [],
    tactVersions: ["1.0.0", "1.4.1", "1.6.2", "1.6.3"],
  }),
}));

describe("TactSourceVerifier", () => {
  const packages = [
    [pkg141, "1.4.1"],
    [pkg162, "1.6.2"],
    [pkg163, "1.6.3"],
  ] as const;

  packages.forEach(([pkg, ver]) => {
    it(`Compiles ${ver}`, async () => {
      const tactVerifier = new TactSourceVerifier({
        writeFile: async (_path, content) => {},
        readFile: async (path) => {
          if (path === "echo.pkg") return Buffer.from(pkg.base64, "base64");
          throw new Error("Unknown path");
        },
        readdir: async () => [],
      });

      const res = await tactVerifier.verify({
        compiler: "tact",
        compilerSettings: { tactVersion: ver },
        knownContractAddress: "",
        knownContractHash: "XhyDRMeBeZs7IK/pJ0XFWNjeKTx2g6n0+hGQ/9Ne2SA=",
        senderAddress: "",
        sources: [
          {
            path: "echo.pkg",
          },
        ],
        tmpDir: "",
      });

      console.log(res.error);

      expect(res.result).toEqual("not_similar");
    });
  });

  it("invalid file format", async function () {
    const tactVerifier = new TactSourceVerifier({
      writeFile: async (_path, content) => {},
      readFile: async (path) => {
        if (path === "echo.pkg") return Buffer.from("{{");
        throw new Error("Unknown path");
      },
      readdir: async () => [],
    });

    const res = await tactVerifier.verify({
      compiler: "tact",
      compilerSettings: { tactVersion: "1.0.0-rc8" },
      knownContractAddress: "",
      knownContractHash: "htGkXV77gc/Tx5Z55tyTyZT8aSpmpnpkFPZpe4lPMIQ=",
      senderAddress: "",
      sources: [
        {
          path: "echo.pkg",
        },
      ],
      tmpDir: "",
    });

    expect(res.result).toEqual("unknown_error");
  });
});
