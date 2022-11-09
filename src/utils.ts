import crypto from "crypto";
import BN from "bn.js";

export function sha256(s: string): Buffer {
  return crypto.createHash("sha256").update(s).digest();
}

export function random64BitNumber() {
  const randomBool = () => (Math.random() > 0.5 ? 1 : 0);
  const random64BitNumber = Array.from({ length: 64 }, randomBool).join("");
  return new BN(random64BitNumber, 2);
}

export function getNowHourRoundedDown() {
  const date = new Date();
  date.setMinutes(0);
  date.setSeconds(0);
  date.setMilliseconds(0);
  return date;
}
