import { RequestHandler } from "express";
import { getLogger, withContext } from "./logger";

const logger = getLogger("request");

export const requestLoggerMiddleware = (): RequestHandler => {
  return (req, res, next) => {
    // Wrap the request handling in withContext to initialize AsyncLocalStorage
    withContext(() => {
      // Add request ID to logger context immediately
      logger.addToContext({
        requestId: req.id,
        method: req.method,
        path: req.path,
        ip: req.ip || req.socket.remoteAddress,
      });

      // Continue with the request
      next();
    });
  };
};
