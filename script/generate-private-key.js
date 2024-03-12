const nacl = require("tweetnacl");

const keypair = nacl.sign.keyPair();
const privKey = Buffer.from(keypair.secretKey).toString("base64");
const pubKey = Buffer.from(keypair.publicKey).toString("base64");

console.log(`Private key: ${privKey}`);
console.log(`Public key: ${pubKey}`);
