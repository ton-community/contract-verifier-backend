import admin from "firebase-admin";
import { Address } from "ton";
import { CodeStorageProvider } from "../code/code-storage-provider";
import { DBSource, SourcesDB } from "./source-db-provider";
import { Base64URL } from "../../controller";
import base64url from "base64url";

export class FirestoreSourcesDB implements SourcesDB {
  private COLLECTION = "sources";
  #app: admin.app.App;

  constructor(firebaseApp: admin.app.App) {
    this.#app = firebaseApp;
  }

  private getCollection() {
    return this.#app.firestore().collection(this.COLLECTION);
  }

  async get(hash: string): Promise<DBSource | undefined> {
    const doc = await this.getCollection()
      .doc(base64url.fromBase64(hash))
      .get();
    const data = doc.data();

    if (!data) return;

    return data as DBSource;
  }

  async add(source: DBSource): Promise<void> {
    await this.getCollection()
      .doc(base64url.fromBase64(source.hash))
      .set(source);
  }
}
