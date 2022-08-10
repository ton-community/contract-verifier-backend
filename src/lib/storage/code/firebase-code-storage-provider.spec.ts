import { initFirebase } from "../../firebase-initializer";
import firebaseConfig from "../../../../secrets/firebase-dev-shahar.json"
import { FirebaseCodeStorageProvider } from "./firebase-code-storage-provider";
import { Readable } from "stream";

describe("Firebase code storage provider", () => {
  jest.setTimeout(10000);

  it("reads the bucket", async () => {
    const app = initFirebase(firebaseConfig);

    const fcsp = new FirebaseCodeStorageProvider(app, {
      bucketName: "my-something-proj-something.appspot.com",
      keyFile: "secrets/firebase-dev-shahar.json",
    });

    const url = await fcsp.read("shahar");

    expect(url).toEqual(
      "https://storage.googleapis.com/my-something-proj-something.appspot.com/shahar"
    );
  });

  it.skip("writes to the bucket", async () => {
    const app = initFirebase(firebaseConfig);

    const fcsp = new FirebaseCodeStorageProvider(app, {
      bucketName: "my-something-proj-something.appspot.com",
      keyFile: "secrets/firebase-dev-shahar.json",
    });

    const locators = await fcsp.write(
      {
        stream: Readable.from(Buffer.from("koko")),
        name: "shahar4",
      },
      {
        stream: Readable.from(Buffer.from("kokoz")),
        name: "shahar5",
      }
    );

    expect(locators).toEqual(["shahar2", "shahar"]);

    // const url = await fcsp.read("jojo");

    // expect(url).toEqual(
    //   "https://storage.googleapis.com/my-something-proj-something.appspot.com/jojo"
    // );
  });
});
