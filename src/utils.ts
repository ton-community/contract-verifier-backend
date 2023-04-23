import { exec, ExecException, ExecOptions } from "child_process";
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

interface ExecResult {
  stdout: string;
  stderr: string;
}

export function execAsyncWithTimeout(
  command: string,
  timeout: number,
  options?: ExecOptions,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (childProcess) {
        childProcess.kill();
      }
      reject(new Error("Execution timed out"));
    }, timeout);

    const childProcess = exec(
      command,
      options,
      (error: ExecException | null, stdout: string, stderr: string) => {
        clearTimeout(timer);
        if (timedOut) return; // Ignore if the process was already killed due to timeout

        if (error) {
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      },
    );
  });
}

export function timeoutPromise<T>(promise: Promise<T>, timeout: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timed out"));
    }, timeout);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
