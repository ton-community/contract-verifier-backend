import { FuncCompilerVersion } from "./types";

export const funcCompilers: { [key in FuncCompilerVersion]: string } = {
  "0.2.0": "resources/binaries/0.2.0",
  "0.3.0": "resources/binaries/0.3.0",
};

export const fiftlibVersion = "d46e4b35387a12a08a48be4b2bb7b52865c34f00";

export const fiftVersions: { [key in FuncCompilerVersion]: string } = {
  "0.2.0": "a9ba27382c7f25618323356b9f408281c6c27704",
  "0.3.0": "20758d6bdd0c1327091287e8a620f660d1a9f4da",
};
