import { initFirebase } from "../../firebase-initializer";
import firebaseConfig from "../../../../secrets/firebase-dev-shahar.json";
import { FirestoreSourcesDB } from "./firestore-source-db-provider";
import { Address } from "ton";

describe("Firebase code storage provider", () => {
  jest.setTimeout(10000);

  it.skip("reads doc", async () => {
    const app = initFirebase(firebaseConfig);

    const fsdb = new FirestoreSourcesDB(app);

    await fsdb.add({
      compiler: "func",
      hash: "QMxxxzzz",
      knownContractAddress: "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c",
      version: "0.0.9",
      sources: [],
      compileCommandLine: null,
      verificationDate: 1,
    });

    const url = await fsdb.get("QMxxxzzz11");

    expect(url).toEqual(
      "https://storage.googleapis.com/my-something-proj-something.appspot.com/shahar"
    );
  });
});
