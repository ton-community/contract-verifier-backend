import { randomUUID } from "crypto";
import { RequestHandler } from "express";

declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

const addId: () => RequestHandler = () => (req, res, next) => {
  req.id = randomUUID();
  next();
};

export default addId;
