import axios from "axios";
import { getLogger } from "./logger";
import promiseRetry from "promise-retry";

const defaultConfig = {
  funcVersions: [
    "0.4.6-wasmfix.0",
    "0.4.6",
    "0.4.5",
    "0.4.4-newops.1",
    "0.4.4-newops",
    "0.4.4",
    "0.4.3",
    "0.4.2",
    "0.4.1",
    "0.4.0",
    "0.3.0",
    "0.2.0",
  ],
  tactVersions: [
    "1.6.13",
    "1.6.12",
    "1.6.11",
    "1.6.10",
    "1.6.7",
    "1.6.6",
    "1.6.5",
    "1.6.4",
    "1.6.3",
    "1.6.2",
    "1.5.4",
    "1.5.3",
    "1.5.2",
    "1.5.1",
    "1.5.0",
    "1.4.4",
    "1.4.3",
    "1.4.2",
    "1.4.1",
    "1.4.0",
    "1.3.1",
    "1.3.0",
    "1.2.0",
    "1.1.5",
    "1.1.4",
    "1.1.3",
    "1.1.2",
    "1.1.1",
    "1.1.0",
    "1.0.0",
  ],
  tolkVersions: ["1.4.0", "1.3.0", "1.2.0", "1.1.0", "1.0.0", "0.12.0"],
};

class SupportedVersionsReader {
  private logger = getLogger("SupportedVersionsReader");
  private _versions: {
    funcVersions: string[];
    tactVersions: string[];
    tolkVersions: string[];
  } | null = null;

  private fetchPromise: Promise<void> | null = null;

  constructor() {
    setInterval(() => {
      this.readVersions();
    }, 30_000);
    void this.readVersions();
  }

  private async readVersions() {
    if (this.fetchPromise) return this.fetchPromise;
    this.fetchPromise = (async () => {
      try {
        await promiseRetry(
          async () => {
            const { data } = await axios.get(
              "https://raw.githubusercontent.com/ton-community/contract-verifier-config/main/config.json",
              { responseType: "json" },
            );
            if (!this._versions) {
              this.logger.info(`Initial fetch of supported versions successful`);
            }
            this._versions = {
              funcVersions: data.funcVersions,
              tactVersions: data.tactVersions,
              tolkVersions: data.tolkVersions,
            };
          },
          {
            retries: 3,
          },
        );
      } catch (e) {
        this._versions = this._versions ?? defaultConfig;
        this.logger.warn("Failed to fetch versions config, using default config", e);
      } finally {
        this.fetchPromise = null;
      }
    })();

    return this.fetchPromise;
  }

  async versions() {
    if (this._versions === null) {
      await this.readVersions();
    }

    if (this._versions === null) {
      throw new Error("Versions were not fetched");
    }

    return this._versions;
  }
}

export const supportedVersionsReader = new SupportedVersionsReader();
