import { Cell, Slice } from "ton";
import { FORWARD_MESSAGE_OP, DEPLOY_SOURCE_OP } from "./controller";

function validateSourcesRegistryMessageCell(slice: Slice, verifierId: Buffer) {
  if (slice.remaining !== 32 + 64 + 256 + 256 || slice.remainingRefs !== 1) {
    throw new Error("Invalid sources registry body cell");
  }

  if (slice.readUint(32).toNumber() !== DEPLOY_SOURCE_OP) {
    throw new Error("Invalid deploy source op");
  }

  slice.skip(64);

  const verifierInMsg = slice.readBuffer(32);

  if (!verifierInMsg.equals(verifierId)) {
    throw new Error("Invalid verifier id");
  }

  console.log(slice.readBuffer(32).toString("base64"));
}

function validateVerifierRegistryBodyCell(
  slice: Slice,
  verifierId: Buffer,
  sourcesRegistryAddress: string,
) {
  if (slice.remaining !== 256 + 32 + 267 + 267 || slice.remainingRefs !== 1) {
    throw new Error("Invalid verifier body cell");
  }

  const verifierInMsg = slice.readBuffer(32);

  if (!verifierInMsg.equals(verifierId)) {
    throw new Error("Invalid verifier id");
  }

  const date = slice.readUint(32);

  const dateInMessage = new Date(date.toNumber() * 1000);

  if (dateInMessage < new Date()) {
    throw new Error("Message is expired");
  }

  const _ = slice.readAddress();
  const sourcesRegInMsg = slice.readAddress()!;

  if (sourcesRegInMsg.toFriendly() !== sourcesRegistryAddress) {
    throw new Error("Invalid sources registry address");
  }

  validateSourcesRegistryMessageCell(slice.readRef(), verifierId);
}

export function validateMessageCell(
  cell: Cell,
  verifierId: Buffer,
  sourcesRegistryAddress: string,
) {
  const slice = cell.beginParse();
  if (slice.remaining !== 32 + 64 || slice.remainingRefs !== 2) {
    throw new Error("Invalid cell");
  }

  // Validate message cell
  if (slice.readUint(32).toNumber() !== FORWARD_MESSAGE_OP) {
    throw new Error("Invalid operation");
  }

  slice.skip(64);

  validateVerifierRegistryBodyCell(slice.readRef(), verifierId, sourcesRegistryAddress);
  // validateSignatureCell(slice.readRef());
}
