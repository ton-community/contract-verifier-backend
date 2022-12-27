import { Address, beginCell, Cell } from "ton";
import BN from "bn.js";
import tweetnacl from "tweetnacl";
export const DEPLOY_SOURCE_OP = 1002;

export function deploySource(
  queryId: BN,
  codeCellHash: string,
  ipfsLink: string,
  verifierId: Buffer,
): Cell {
  return beginCell()
    .storeUint(DEPLOY_SOURCE_OP, 32)
    .storeUint(queryId, 64)
    .storeBuffer(verifierId)
    .storeUint(new BN(Buffer.from(codeCellHash, "base64")), 256)
    .storeRef(
      // Source item content cell
      beginCell().storeUint(1, 8).storeBuffer(Buffer.from(ipfsLink)).endCell(),
    )
    .endCell();
}

export const FORWARD_MESSAGE_OP = 0x75217758;

export function verifierRegistryForwardMessage(
  queryId: BN,
  msgToSign: Cell,
  sigCell: Cell,
): Buffer | undefined {
  return beginCell()
    .storeUint(FORWARD_MESSAGE_OP, 32) // Forward message
    .storeUint(queryId, 64)
    .storeRef(msgToSign)
    .storeRef(sigCell)
    .endCell()
    .toBoc();
}

export function cellToSign(
  senderAddress: string,
  queryId: BN,
  codeCellHash: string,
  ipfsLink: string,
  sourcesRegistry: string,
  verifierIdSha256: Buffer,
) {
  return beginCell()
    .storeBuffer(verifierIdSha256)
    .storeUint(Math.floor(Date.now() / 1000) + 60 * 10, 32) // Valid until 10 minutes from now
    .storeAddress(Address.parse(senderAddress))
    .storeAddress(Address.parse(sourcesRegistry))
    .storeRef(deploySource(queryId, codeCellHash, ipfsLink, verifierIdSha256))
    .endCell();
}

export function signatureCell(msgToSign: Cell, keypair: tweetnacl.SignKeyPair) {
  const sig = Buffer.from(tweetnacl.sign.detached(msgToSign.hash(), keypair.secretKey));

  const sigCell = beginCell()
    .storeBuffer(sig)
    .storeBuffer(Buffer.from(keypair.publicKey))
    .endCell();

  return { sig, sigCell };
}
