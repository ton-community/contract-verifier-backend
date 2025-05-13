import { getLogger } from "./logger";
import admin from "firebase-admin";

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!);

serviceAccount.private_key = serviceAccount.private_key.replaceAll("\\n", "\n");

const app = admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DB_URL,
});

const db = app.database();
const logger = getLogger("firebase-provider");

// We use this for descending order
const MAX_TS = 9999999999999;

class FirebaseProvider {
  async addForDescendingOrder<T>(key: string, data: T) {
    const r = db.ref(key);

    // For descending order
    const childKey = String(MAX_TS - Date.now()).padStart(13, "0"); // consistent length

    await r.child(childKey).set(data);
  }

  async set<T>(key: string, val: T) {
    return db.ref(key).set(val);
  }

  async get<T>(key: string): Promise<T | null> {
    const val = await db.ref(key).get();

    if (!val.exists()) return null;

    return val.val();
  }

  async readItems<T>(key: string, limit = 500) {
    try {
      const r = db.ref(key);
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
