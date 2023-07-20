import { Address, Cell, Slice } from "ton";
import tweetnacl from "tweetnacl";
import { DEPLOY_SOURCE_OP, FORWARD_MESSAGE_OP } from "./cell-builders";
import { VerifierConfig } from "./ton-reader-client";

function validateSignatureCell(
  slice: Slice,
  signedCell: Cell,
  keypair: tweetnacl.SignKeyPair,
  verifierConfig: VerifierConfig,
) {
  let currRef: Slice | null = slice;

  if (verifierConfig.quorum <= 1 || verifierConfig.verifiers.length < verifierConfig.quorum) {
    throw new Error("Mulisig quorum must be greater than 1");
  }

  if (!verifierConfig.verifiers.find((v) => v.equals(keypair.publicKey))) {
    throw new Error("This verifier is not in the multisig config");
  }

  const sigs: Record<string, boolean> = {};
  let sigCount = 0;

  while (currRef) {
    sigCount += 1;

    if (sigCount >= verifierConfig.quorum) {
      throw new Error("Too many signatures");
    }

    if (currRef.remainingBits !== 512 + 256) {
      throw new Error("Invalid signature cell");
    }

    const sig = currRef.loadBuffer(512 / 8);

    if (sigs[sig.toString("base64")] === true) {
      throw new Error("Duplicate signature");
    }

    const pubKey = currRef.loadBuffer(256 / 8);

    if (pubKey.equals(keypair.publicKey)) {
      throw new Error("Invalid signature (signed by self)");
    }

    const isValid = tweetnacl.sign.detached.verify(signedCell.hash(), sig, pubKey);

    if (!isValid) {
      throw new Error("Invalid signature");
    }

    if (currRef.remainingRefs === 1) {
      currRef = currRef.loadRef().asSlice();
    } else if (currRef.remainingRefs === 0) {
      currRef = null;
    } else {
      throw new Error("Invalid signature cell");
    }

    sigs[sig.toString("base64")] = true;
  }
}

function validateSourcesRegistryMessageCell(slice: Slice, verifierId: Buffer) {
  if (slice.remainingBits !== 32 + 64 + 256 + 256 || slice.remainingRefs !== 1) {
    throw new Error("Invalid sources registry body cell");
  }

  if (slice.loadUint(32) !== DEPLOY_SOURCE_OP) {
    throw new Error("Invalid deploy source op");
  }

  slice.skip(64);

  const verifierInMsg = slice.loadBuffer(32);

  if (!verifierInMsg.equals(verifierId)) {
    throw new Error("Invalid verifier id");
  }

  const codeCellHash = slice.loadBuffer(32).toString("base64");

  const contentCell = slice.loadRef().asSlice();
  if (contentCell.loadUint(8) !== 1) {
    throw new Error("Unsupported version of source item content cell");
  }

  const ipfsPointer = contentCell.loadBuffer(contentCell.remainingBits / 8).toString("utf-8");
  return {
    codeCellHash,
    ipfsPointer,
  };
}

function validateVerifierRegistryBodyCell(
  slice: Slice,
  verifierId: Buffer,
  sourcesRegistryAddress: string,
) {
  if (slice.remainingBits !== 256 + 32 + 267 + 267 || slice.remainingRefs !== 1) {
    throw new Error("Invalid verifier body cell");
  }

  const verifierInMsg = slice.loadBuffer(32);

  if (!verifierInMsg.equals(verifierId)) {
    throw new Error("Invalid verifier id");
  }

  const date = slice.loadUint(32);

  const dateInMessage = new Date(date * 1000);

  if (dateInMessage < new Date()) {
    throw new Error("Message is expired");
  }

  const senderAddress = slice.loadAddress()!;
  const sourcesRegInMsg = slice.loadAddress()!;

  if (sourcesRegInMsg.toString() !== sourcesRegistryAddress) {
    throw new Error("Invalid sources registry address");
  }

  return {
    senderAddress,
    date,
    ...validateSourcesRegistryMessageCell(slice.loadRef().asSlice(), verifierId),
  };
}

export function validateMessageCell(
  cell: Cell,
  verifierId: Buffer,
  sourcesRegistryAddress: string,
  keypair: tweetnacl.SignKeyPair,
  verifierConfig: VerifierConfig,
) {
  const slice = cell.beginParse();
  if (slice.remainingBits !== 32 + 64 || slice.remainingRefs !== 2) {
    throw new Error("Invalid cell");
  }

  // Validate message cell
  if (slice.loadUint(32) !== FORWARD_MESSAGE_OP) {
    throw new Error("Invalid operation");
  }

  const queryId = slice.loadUint(64);

  const signedCell = slice.loadRef();

  const { ipfsPointer, codeCellHash, senderAddress, date } = validateVerifierRegistryBodyCell(
    signedCell.asSlice(),
    verifierId,
    sourcesRegistryAddress,
  );
  validateSignatureCell(slice.loadRef().asSlice(), signedCell, keypair, verifierConfig);

  return {
    ipfsPointer,
    codeCellHash,
    senderAddress,
    date,
    queryId,
  };
}
