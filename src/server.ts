import express from "express";
require("express-async-errors");
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import cors from "cors";
import { Controller } from "./controller";
import multer from "multer";
import { readFile, rm } from "fs/promises";
import mkdirp from "mkdirp";
import { rmSync } from "fs";
import path from "path";
import idMiddleware from "./req-id-middleware";
import { IpfsCodeStorageProvider } from "./ipfs-code-storage-provider";
import rateLimit from "express-rate-limit";
import { checkPrerequisites } from "./check-prerequisites";
import { FiftSourceVerifier } from "./source-verifier/fift-source-verifier";
import { FuncSourceVerifier } from "./source-verifier/func-source-verifier";
import { TactSourceVerifier } from "./source-verifier/tact-source-verifier";
import { getHttpEndpoint } from "@orbs-network/ton-gateway";
import { TonClient } from "ton";
import { TonReaderClientImpl } from "./ton-reader-client";

const app = express();
app.use(idMiddleware());
app.use(cors());
app.use(express.json());

checkPrerequisites();

const limiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 25, // Limit each IP to 25 requests per `window`
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Set up file handling
const TMP_DIR = "./tmp";
rmSync(TMP_DIR, { recursive: true, force: true });

app.use(async (req, res, next) => {
  const _path = path.join(TMP_DIR, req.id);
  await mkdirp(_path);
  next();
});

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, callback) => {
      const _path = path.join(
        TMP_DIR,
        req.id,
        file.fieldname.match(/\//) ? file.fieldname.split("/")[0] : "",
      );

      await mkdirp(_path);
      callback(null, _path);
    },
    filename: (req, file, callback) => {
      callback(null, file.originalname);
    },
  }),
});

app.use((req, res, next) => {
  if (process.env.DISABLE_RM) {
    next();
    return;
  }
  res.on("close", async () => {
    if (req.files) {
      rm(path.join(TMP_DIR, req.id), { recursive: true, force: true });
    }
  });
  next();
});
const port = process.env.PORT || 3003;

// Routes
app.get("/hc", (req, res) => {
  res.send("ok");
});

(async () => {
  const endpoint = await getHttpEndpoint();
  const tc = new TonClient({ endpoint });

  const controller = new Controller(
    new IpfsCodeStorageProvider(),
    {
      func: new FuncSourceVerifier(),
      fift: new FiftSourceVerifier(),
      tact: new TactSourceVerifier(),
    },
    {
      verifierId: process.env.VERIFIER_ID!,
      allowReverification: !!process.env.ALLOW_REVERIFICATION,
      privateKey: process.env.PRIVATE_KEY!,
      sourcesRegistryAddress: process.env.SOURCES_REGISTRY!,
      verifierRegistryAddress: process.env.VERIFIER_REGISTRY!,
    },
    new TonReaderClientImpl(tc),
  );

  app.post(
    "/source",
    limiter,
    async (req, _, next) => {
      await mkdirp(path.join(TMP_DIR, req.id));
      next();
    },
    upload.any(),
    async (req, res) => {
      const jsonFile = (req.files! as any[]).find((f) => f.fieldname === "json").path;

      const jsonData = await readFile(jsonFile);
      const body = JSON.parse(jsonData.toString());

      const result = await controller.addSource({
        compiler: body.compiler,
        compilerSettings: body.compilerSettings,
        sources: (req.files! as any[])
          .filter((f: any) => f.fieldname !== "json")
          .map((f, i) => ({
            path: f.fieldname,
            ...body.sources[i],
          })),
        knownContractAddress: body.knownContractAddress,
        knownContractHash: body.knownContractHash,
        tmpDir: path.join(TMP_DIR, req.id),
        senderAddress: body.senderAddress,
      });

      res.json(result);
    },
  );

  app.post("/sign", limiter, async (req, res) => {
    const result = await controller.sign({
      messageCell: req.body.messageCell.data,
      tmpDir: path.join(TMP_DIR, req.id),
    });
    res.json(result);
  });

  app.listen(port, () => {
    console.log(`Ton Contract Verifier Server running on ${port}`);
  });
})();
