// import { FirebaseOptions, initializeApp } from "firebase/app";
import admin from "firebase-admin";
let app: admin.app.App;

export type FirebaseConfig = {
  project_id: string;
  client_email: string;
  private_key: string;
};

export function initFirebase(firebaseConfig: FirebaseConfig) {
  if (!app) {
    app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: firebaseConfig.project_id,
        clientEmail: firebaseConfig.client_email,
        privateKey: firebaseConfig.private_key,
      }),
    });
  }

  return app;
}
