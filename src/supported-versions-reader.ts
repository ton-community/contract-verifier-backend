import axios from "axios";
import { getLogger } from "./logger";
import promiseRetry from "promise-retry";

class SupportedVersionsReader {
  private logger = getLogger("SupportedVersionsReader");
  private _versions: {
    funcVersions: string[];
    tactVersions: string[];
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
            };
          },
          {
            retries: 3,
          },
        );
      } catch (e) {
        this.logger.warn(e);
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
