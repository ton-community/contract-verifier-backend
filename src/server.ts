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
import { requestLoggerMiddleware } from "./request-logger-middleware";
import rateLimit from "express-rate-limit";
import { checkPrerequisites } from "./check-prerequisites";
import { FiftSourceVerifier, specialCharsRegex } from "./source-verifier/fift-source-verifier";
import { TactSourceVerifier, FileSystem } from "./source-verifier/tact-source-verifier";
import { TolkSourceVerifier } from "./source-verifier/tolk-source-verifier";
import { TonReaderClientImpl } from "./ton-reader-client";
import { getLatestVerified, pollLatestVerified } from "./latest-known-contracts";
import { DeployController } from "./deploy-controller";
import { getLogger } from "./logger";
import { FuncJSSourceVerifier } from "./source-verifier/funcjs-source-verifier";
import { createCodeStorageProvider } from "./codestorage";
import { createIndexStorage } from "./indexstorage";

const logger = getLogger("server");

const app = express();
app.use(idMiddleware());
app.use(requestLoggerMiddleware());
app.use(cors());
app.use(express.json());

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
      const _path = path.join(TMP_DIR, req.id, ...file.fieldname.split("/").slice(0, -1));

      await mkdirp(_path);
      callback(null, _path);
    },
    filename: (req, file, callback) => {
      callback(null, file.originalname);
    },
  }),
  limits: {
    files: 150,
    fileSize: 1024 * 1024,
  },
  fileFilter(req, file, callback) {
    callback(
      null,
      !specialCharsRegex().test(file.originalname) && !specialCharsRegex().test(file.fieldname),
    );
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
    callback(
      null,
      !!file.originalname.match(/\.(boc|pkg)/) &&
        !specialCharsRegex().test(file.originalname) &&
        !specialCharsRegex().test(file.fieldname),
    );
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
    createCodeStorageProvider(
      process.env.IPFS_STORAGE_PROVIDER,
      process.env.TACT_DEPLOYER_INFURA_ID,
      process.env.TACT_DEPLOYER_INFURA_SECRET,
      process.env.TACT_DEPLOYER_PINATA_JWT,
      process.env.TACT_DEPLOYER_PINATA_GATEWAY,
    ),
    fileSystem,
  );

  const controller = new Controller(
    createCodeStorageProvider(
      process.env.IPFS_STORAGE_PROVIDER,
      process.env.INFURA_ID,
      process.env.INFURA_SECRET,
      process.env.PINATA_JWT,
      process.env.PINATA_GATEWAY,
    ),
    {
      func: new FuncJSSourceVerifier(),
      fift: new FiftSourceVerifier(),
      tolk: new TolkSourceVerifier(),
      tact: new TactSourceVerifier(fileSystem),
    },
    {
      verifierId: process.env.VERIFIER_ID!,
      allowReverification: !!process.env.ALLOW_REVERIFICATION,
      privateKey: process.env.PRIVATE_KEY!,
      sourcesRegistryAddress: process.env.SOURCES_REGISTRY!,
    },
    new TonReaderClientImpl(),
  );

  const indexStorage = createIndexStorage(process.env.STORAGE_PROVIDER || "valkey");

  if (process.env.NODE_ENV === "production")
    pollLatestVerified(indexStorage, process.env.IPFS_PROVIDER!);

  app.post(
    "/source",
    limiter,
    async (req, _, next) => {
      await mkdirp(path.join(TMP_DIR, req.id));
      next();
    },
    sourcesUpload.any(),
    async (req, res) => {
      logger.info("Processing source verification request", {
        filesCount: (req.files as any[]).length,
      });

      const jsonFile = (req.files! as any[]).find((f) => f.fieldname === "json").path;

      const jsonData = await readFile(jsonFile);
      const body = JSON.parse(jsonData.toString());

      logger.debug("Parsed request body", {
        compiler: body.compiler,
        sourcesCount: body.sources?.length,
        knownContractAddress: body.knownContractAddress,
      });

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

      logger.info("Source verification request completed", {
        result: result.compileResult?.result,
        hash: result.compileResult?.hash,
      });

      res.json(result);
    },
  );

  app.post("/sign", limiter, async (req, res) => {
    const result = await controller.sign({
      messageCell: req.body.messageCell.data,
      tmpDir: path.join(TMP_DIR, req.id),
    });

    logger.info("Sign request completed successfully");
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
      try {
        const result = await deployController.process({
          tmpDir: path.join(TMP_DIR, req.id),
        });
        logger.info("Tact deployment request completed successfully");
        res.json(result);
      } catch (e) {
        logger.error("Tact deployment request failed", { error: e.toString() });
        res.status(500).send(e.toString());
      }
    },
  );

  if (process.env.NODE_ENV === "production") checkPrerequisites();

  app.get("/latestVerified", async (req, res) => {
    const result = await getLatestVerified(indexStorage);
    logger.info("Latest verified contracts fetched", {
      count: result?.length || 0,
    });
    res.json(result);
  });

  app.use(function (err: any, req: any, res: any, next: any) {
    logger.error("Request error", {
      error: err,
      statusCode: err.statusCode || 500,
      message: err.message || err.toString(),
      path: req.path,
      method: req.method,
    });

    const statusCode = err.statusCode || 500;
    const errorMessage = err.message || err.toString() || "Unknown error";
    res.status(statusCode).send({ statusCode, message: errorMessage });
  });

  app.listen(port, () => {
    logger.info(
      `Ton Contract Verifier Server running on ${port}. Verifier Id: ${process.env.VERIFIER_ID}`,
    );
  });
})();
