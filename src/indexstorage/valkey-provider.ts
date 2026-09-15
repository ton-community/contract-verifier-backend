import { getLogger } from "../logger";
import Redis from "ioredis";

// We use this for descending order
const MAX_TS = 9999999999999;

const logger = getLogger("valkey-provider");

export class ValkeyProvider {
  private _client: Redis | null = null;

  private get client(): Redis {
    if (!this._client) {
      logger.info("Initializing Valkey connection");
      const host = process.env.VALKEY_HOST || "localhost";
      const port = parseInt(process.env.VALKEY_PORT || "6379", 10);
      const password = process.env.VALKEY_PASSWORD;
      const db = parseInt(process.env.VALKEY_DB || "0", 10);

      this._client = new Redis({
        host,
        port,
        password,
        db,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          logger.warn(`Reconnecting to Valkey... attempt ${times}`);
          return delay;
        },
        maxRetriesPerRequest: 3,
      });

      this._client.on("error", (err) => {
        logger.error("Valkey client error:", err);
      });

      this._client.on("connect", () => {
        logger.info("Connected to Valkey");
      });
    }
    return this._client;
  }

  async addForDescendingOrder<T>(key: string, data: T) {
    // For descending order, use a sorted set with timestamp-based scores
    const childKey = String(MAX_TS - Date.now()).padStart(13, "0");
    const member = JSON.stringify({ key: childKey, data });

    // Use the inverted timestamp as the score for descending order
    const score = MAX_TS - Date.now();

    await this.client.zadd(key, score, member);
  }

  async set<T>(key: string, val: T) {
    await this.client.set(key, JSON.stringify(val));
  }

  async setWithTxn<T>(key: string, txn: (val: T | null) => T | void | null) {
    const maxRetries = 10;
    let retries = 0;

    while (retries < maxRetries) {
      try {
        // Watch the key for changes
        await this.client.watch(key);

        // Get current value
        const currentValue = await this.client.get(key);
        const parsedValue: T | null = currentValue ? JSON.parse(currentValue) : null;

        // Execute transaction function
        const newValue = txn(parsedValue);

        // If transaction function returns undefined, abort
        if (newValue === undefined) {
          await this.client.unwatch();
          return { committed: false, snapshot: parsedValue };
        }

        // Start transaction
        const result = await this.client.multi().set(key, JSON.stringify(newValue)).exec();

        if (result === null) {
          // Transaction failed due to watched key modification
          retries++;
          logger.debug(`Transaction retry ${retries}/${maxRetries}`);
          continue;
        }

        return { committed: true, snapshot: newValue };
      } catch (error) {
        await this.client.unwatch();
        throw error;
      }
    }

    await this.client.unwatch();
    throw new Error("Transaction failed after maximum retries");
  }

  async remove(key: string) {
    await this.client.del(key);
  }

  async get<T>(key: string): Promise<T | null> {
    const val = await this.client.get(key);

    if (!val) return null;

    return JSON.parse(val);
  }

  async readItems<T>(key: string, limit = 500): Promise<T[] | null> {
    try {
      // Read from sorted set in ascending order (which gives us descending chronological order)
      const members = await this.client.zrange(key, 0, limit - 1);

      if (members.length === 0) {
        return null;
      }

      const items: T[] = [];

      for (const member of members) {
        const parsed = JSON.parse(member);
        items.push(parsed.data);
      }

      return items;
    } catch (e) {
      logger.warn(e);
      return null;
    }
  }

  async disconnect() {
    if (this._client) {
      await this._client.quit();
      this._client = null;
    }
  }
}
