import { Cell, Slice } from "ton";
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

    if (currRef.remaining !== 512 + 256) {
      throw new Error("Invalid signature cell");
    }

    const sig = currRef.readBuffer(512 / 8);

    if (sigs[sig.toString("base64")] === true) {
      throw new Error("Duplicate signature");
    }

    const pubKey = currRef.readBuffer(256 / 8);

    if (pubKey.equals(keypair.publicKey)) {
      throw new Error("Invalid signature (signed by self)");
    }

    const isValid = tweetnacl.sign.detached.verify(signedCell.hash(), sig, pubKey);

    if (!isValid) {
      throw new Error("Invalid signature");
    }

    if (currRef.remainingRefs === 1) {
      currRef = currRef.readRef();
    } else if (currRef.remainingRefs === 0) {
      currRef = null;
    } else {
      throw new Error("Invalid signature cell");
    }

    sigs[sig.toString("base64")] = true;
  }
}

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

  const codeCellHash = slice.readBuffer(32).toString("base64");

  const contentCell = slice.readRef();
  if (contentCell.readUint(8).toNumber() !== 1) {
    throw new Error("Unsupported version of source item content cell");
  }

  const ipfsPointer = contentCell.readRemainingBytes().toString("utf8");
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
  if (slice.remaining !== 256 + 32 + 267 + 267 || slice.remainingRefs !== 1) {
    throw new Error("Invalid verifier body cell");
  }

  const verifierInMsg = slice.readBuffer(32);

  if (!verifierInMsg.equals(verifierId)) {
    throw new Error("Invalid verifier id");
  }

  const date = slice.readUint(32).toNumber();

  const dateInMessage = new Date(date * 1000);

  if (dateInMessage < new Date()) {
    throw new Error("Message is expired");
  }

  const senderAddress = slice.readAddress()!;
  const sourcesRegInMsg = slice.readAddress()!;

  if (sourcesRegInMsg.toFriendly() !== sourcesRegistryAddress) {
    throw new Error("Invalid sources registry address");
  }

  return {
    senderAddress,
    date,
    ...validateSourcesRegistryMessageCell(slice.readRef(), verifierId),
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
  if (slice.remaining !== 32 + 64 || slice.remainingRefs !== 2) {
    throw new Error("Invalid cell");
  }

  // Validate message cell
  if (slice.readUint(32).toNumber() !== FORWARD_MESSAGE_OP) {
    throw new Error("Invalid operation");
  }

  const queryId = slice.readUint(64);

  const signedSlice = slice.readRef();
  const signedCell = signedSlice.toCell();

  const { ipfsPointer, codeCellHash, senderAddress, date } = validateVerifierRegistryBodyCell(
    signedSlice,
    verifierId,
    sourcesRegistryAddress,
  );
  validateSignatureCell(slice.readRef(), signedCell, keypair, verifierConfig);

  return {
    ipfsPointer,
    codeCellHash,
    senderAddress,
    date,
    queryId,
  };
}
