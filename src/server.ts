import express from "express";
require("express-async-errors");
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import cors from "cors";
import { Controller } from "./controller";
import multer from "multer";
import { readFile, rm, writeFile, readdir } from "fs/promises";
import mkdirp from "mkdirp";
import { rmSync } from "fs";
import path from "path";
import idMiddleware from "./req-id-middleware";
import { IpfsCodeStorageProvider } from "./ipfs-code-storage-provider";
import rateLimit from "express-rate-limit";
import { checkPrerequisites } from "./check-prerequisites";
import { FiftSourceVerifier } from "./source-verifier/fift-source-verifier";
import { FuncSourceVerifier } from "./source-verifier/func-source-verifier";
import { TactSourceVerifier, FileSystem } from "./source-verifier/tact-source-verifier";
import { TonReaderClientImpl } from "./ton-reader-client";
import { getLatestVerified } from "./latest-known-contracts";
import { DeployController } from "./deploy-controller";

const app = express();
app.use(idMiddleware());
app.use(cors());
app.use(express.json());

if (process.env.NODE_ENV === "production") checkPrerequisites();

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

const sourcesUpload = multer({
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
  limits: {
    files: 50,
    fileSize: 200 * 1024,
  },
});

const tactStagingUpload = multer({
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
  limits: {
    files: 2,
    fileSize: 200 * 1024,
  },
  fileFilter(req, file, callback) {
    console.log(file);
    if (!file.originalname.match(/\.(boc|pkg)/)) {
      callback(new Error("Only boc or pkg are allowed"));
      return;
    }
    callback(null, true);
  },
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
  const fileSystem: FileSystem = {
    readFile: readFile,
    writeFile: async (filePath, content) => {
      await mkdirp(path.dirname(filePath));
      await writeFile(filePath, content);
    },
    readdir: async (path) => readdir(path),
  };

  const deployController = new DeployController(
    new IpfsCodeStorageProvider(
      process.env.TACT_DEPLOYER_INFURA_ID!,
      process.env.TACT_DEPLOYER_INFURA_SECRET!,
    ),
    fileSystem,
  );

  const controller = new Controller(
    new IpfsCodeStorageProvider(process.env.INFURA_ID!, process.env.INFURA_SECRET!),
    {
      func: new FuncSourceVerifier(),
      fift: new FiftSourceVerifier(),
      tact: new TactSourceVerifier(fileSystem),
    },
    {
      verifierId: process.env.VERIFIER_ID!,
      allowReverification: !!process.env.ALLOW_REVERIFICATION,
      privateKey: process.env.PRIVATE_KEY!,
      sourcesRegistryAddress: process.env.SOURCES_REGISTRY!,
      verifierRegistryAddress: process.env.VERIFIER_REGISTRY!,
    },
    new TonReaderClientImpl(),
  );

  // Not awaiting on purpose, otherwise this may take too much time.
  getLatestVerified(process.env.VERIFIER_ID!, process.env.IPFS_PROVIDER!);

  app.post(
    "/source",
    limiter,
    async (req, _, next) => {
      await mkdirp(path.join(TMP_DIR, req.id));
      next();
    },
    sourcesUpload.any(),
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

  app.post(
    "/prepareTactDeployment",
    limiter,
    async (req, _, next) => {
      await mkdirp(path.join(TMP_DIR, req.id));
      next();
    },
    tactStagingUpload.any(),
    async (req, res) => {
      const result = await deployController.process({
        tmpDir: path.join(TMP_DIR, req.id),
      });
      res.json(result);
    },
  );

  app.get("/latestVerified", async (req, res) => {
    res.json(await getLatestVerified(process.env.VERIFIER_ID!, process.env.IPFS_PROVIDER!));
  });

  app.use(function (err: any, req: any, res: any, next: any) {
    console.error(err.message); // Log error message in our server's console
    if (!err.statusCode) err.statusCode = 500; // If err has no specified error code, set error code to 'Internal Server Error (500)'
    res.status(err.statusCode).send(err); // All HTTP requests must have a response, so let's send back an error with its status
  });

  app.listen(port, () => {
    console.log(
      `Ton Contract Verifier Server running on ${port}. Verifier Id: ${process.env.VERIFIER_ID}`,
    );
  });
})();
