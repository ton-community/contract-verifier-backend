import { getLogger } from "./logger";
import admin from "firebase-admin";

// We use this for descending order
const MAX_TS = 9999999999999;

const logger = getLogger("firebase-provider");

class FirebaseProvider {
  db: admin.database.Database;

  constructor() {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!);
    serviceAccount.private_key = serviceAccount.private_key.replaceAll("\\n", "\n");
    const app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DB_URL,
    });
    this.db = app.database();
  }

  async addForDescendingOrder<T>(key: string, data: T) {
    const r = this.db.ref(key);

    // For descending order
    const childKey = String(MAX_TS - Date.now()).padStart(13, "0"); // consistent length

    await r.child(childKey).set(data);
  }

  async set<T>(key: string, val: T) {
    return this.db.ref(key).set(val);
  }

  async setWithTxn<T>(key: string, txn: (val: T) => void) {
    return this.db.ref(key).transaction(txn);
  }

  async remove<T>(key: string) {
    return this.db.ref(key).remove();
  }

  async get<T>(key: string): Promise<T | null> {
    const val = await this.db.ref(key).get();

    if (!val.exists()) return null;

    return val.val();
  }

  async readItems<T>(key: string, limit = 500) {
    try {
      const r = this.db.ref(key);
      const res = await r.orderByKey().limitToFirst(limit).get();

      if (res.exists()) {
        const items: T[] = [];

        res.forEach((v) => {
          items.push(v.val());
        });

        return items;
      } else {
        return null;
      }
    } catch (e) {
      logger.warn(e);
      return null;
    }
  }
}

export const firebaseProvider = new FirebaseProvider();
