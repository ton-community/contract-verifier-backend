import winston, { format, LoggerModified, LoggerOptions } from "winston";

import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";
import randomstring from "randomstring";

const asyncLocalStorage = new AsyncLocalStorage<Map<string, unknown>>();
const globalContext = new Map<string, unknown>();

declare module "winston" {
  interface LoggerModified {
    debug: Logger["debug"];
    info: Logger["info"];
    warn: Logger["warn"];
    error: Logger["error"];

    addToContext: (entries: { [key: string]: unknown }) => LoggerModified;
    addToGlobalContext: (entries: { [key: string]: unknown }) => LoggerModified;

    debugSampled: (rate: number, message: unknown, ...args: unknown[]) => LoggerModified;
  }
}

const instanceId = randomstring.generate(6);

const customLevels = {
  levels: {
    critical: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
  },
};

export function getLogger(
  module: string,
  meta: Record<string, unknown> = {},
  level: string = "debug",
) {
  const defaultMeta: LoggerOptions["defaultMeta"] = {
    module,
    instanceId,
  };

  const addMetaAndStack = winston.format.printf((info) => {
    info.meta = (info[Symbol.for("splat")] as unknown[])?.[0] ?? {};
    info.meta = { ...(info.meta as any), ...meta };

    if (info.stack) (info.message as any) += info.stack;

    let stringified = JSON.stringify(info.meta);
    delete info.meta;

    if (stringified === "{}") stringified = "";
    return `${info.timestamp} ${info.service} ${module} ${info.level.toUpperCase()} ${
      info.message
    } ${stringified}`;
  });

  const _logger = winston.createLogger({
    levels: customLevels.levels,
    level,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.prettyPrint(),
      addMetaAndStack,
      winston.format((info) => {
        info.context = { ...(info.context ?? {}), ...Object.fromEntries(globalContext) };
        const store = asyncLocalStorage.getStore();
        if (!store) return info;
        info.context = { ...(info.context as any), ...Object.fromEntries(store.entries()) };
        return info;
      })(),
    ),
    defaultMeta: defaultMeta,
    transports: [
      new winston.transports.Console({
        format: process.env.NO_JSON_LOGGING
          ? format.printf((info) => {
              return `${info[Symbol.for("message")]}`;
            })
          : winston.format.json(),
      }),
    ],
  });

  const logWithStackTrace = (errorCode: string, message: unknown, ...args: unknown[]) => {
    let msg = message;

    args[0] = { errorCode, ...(args[0] ?? {}) };

    if (typeof message === "string") {
      const err = new Error(message as never);
      // Remove the line coming from the synthetic error created the line above
      err.stack = err.stack?.replace(new RegExp(`^\\s+at.*_logger\\.${"error"}.*$\\n`, "m"), "");
      msg = err;
    } else if (!(message instanceof Error) && typeof message === "object") {
      msg = JSON.stringify(message);
    }

    _logger.log("error", msg as never, ...args);

    return _logger;
  };

  // Override logger error to always print stack traces
  _logger.error = (message: unknown, ...args: unknown[]) =>
    logWithStackTrace("error", message, ...args);

  const logger = _logger as unknown as LoggerModified;

  logger.addToContext = (entries: { [key: string]: unknown }) => {
    const store = asyncLocalStorage.getStore();
    if (!store) {
      logger.error(
        "addToContext must be called inside of an async function wrapped in withContext",
        {
          ...entries,
        },
      );
      return logger;
    }

    Object.entries(entries).forEach(([key, value]) => store.set(key, value));

    return logger;
  };

  logger.debugSampled = (rate: number, message: unknown, ...args: unknown[]) => {
    if (rate <= 0 || rate > 1) {
      logger.warn("sampleOnce rate must be between 0 and 1, ignoring", { rate });
      return logger;
    }

    if (Math.random() < rate) {
      logger.debug(message as unknown as string, ...args);
    }

    return logger;
  };

  logger.addToGlobalContext = (entries: { [key: string]: unknown }) => {
    Object.entries(entries).forEach(([key, value]) => globalContext.set(key, value));
    return logger;
  };

  return logger;
}

export function withContext<T>(fn: () => T) {
  let store = asyncLocalStorage.getStore();

  if (store) {
    throw new Error(
      "cannot use withContext inside an async function that is already wrapped in withContext",
    );
  }

  store = new Map();
  store.set("traceId", randomUUID());

  return asyncLocalStorage.run(store, fn);
}

export function hasContext() {
  return asyncLocalStorage.getStore() !== undefined;
}

export function getContext() {
  const store = asyncLocalStorage.getStore();

  if (!store) {
    throw new Error("getContext must be called inside of an async function wrapped in withContext");
  }

  return Object.fromEntries(store.entries());
}
