import express from "express";
require("express-async-errors");
require("dotenv").config();

import cors from "cors";
import { Controller } from "./lib/controller";
import { initFirebase } from "./lib/firebase-initializer";
import multer from "multer";
import { readFile, rm } from "fs/promises";
import mkdirp from "mkdirp";
import { FirestoreSourcesDB } from "./lib/storage/db/firestore-source-db-provider";
import { FuncSourceVerifier } from "./lib/compiler/func-source-verifier";
import { rmSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import idMiddleware from "./req-id-middleware";
import { IpfsCodeStorageProvider } from "./lib/storage/code/ipfs-code-storage-provider";

const firebaseSecret = JSON.parse(
  Buffer.from(process.env.FIREBASE_SECRET!, "base64").toString()
);

const firebaseApp = initFirebase(firebaseSecret);

const controller = new Controller(
  new IpfsCodeStorageProvider(),
  new FirestoreSourcesDB(firebaseApp),
  new FuncSourceVerifier()
);

const app = express();
app.use(idMiddleware());
app.use(cors());
app.use(express.json());

// Set up file handling
const TMP_DIR = "./tmp";
rmSync(TMP_DIR, { recursive: true, force: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, callback) => {
      callback(null, path.join(TMP_DIR, req.id));
    },
    filename: (req, file, callback) => {
      callback(null, file.originalname);
    },
  }),
});

app.use((req, res, next) => {
  res.on("close", async () => {
    if (req.files) {
      rm(path.join(TMP_DIR, req.id), { recursive: true, force: true });
    }
  });
  next();
});
const port = process.env.PORT || 3003;

// Routes
app.get("/source/:hashBase64URL", async (req, res) => {
  const data = await controller.getSource(req.params.hashBase64URL);
  if (!data) {
    return res.status(404).end();
  }
  res.json(data);
});

app.post(
  "/source",
  async (req, res, next) => {
    await mkdirp(path.join(TMP_DIR, req.id));
    next();
  },
  upload.any(),
  async (req, res, next) => {
    const jsonFile = (req.files! as any[]).find(
      (f) => f.fieldname === "json"
    ).path;

    const jsonData = await readFile(jsonFile);
    const body = JSON.parse(jsonData.toString());

    const result = await controller.addSource({
      compiler: body.compiler,
      version: body.version,
      compileCommandLine: body.compileCommandLine, // TODO sanitize
      sources: (req.files! as any[])
        .filter((f: any) => f.fieldname !== "json")
        .map((f, i) => ({
          path: f.path,
          ...body.sources[i],
        })),
      knownContractAddress: body.knownContractAddress,
      knownContractHash: body.knownContractHash,
      tmpDir: path.join(TMP_DIR, req.id),
    });

    res.json(result);
  }
);

app.listen(port, () => {
  console.log(`Ton sources server running on ${port}`);
});
