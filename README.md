# contract-verifier-backend

A backend used for compiling FunC code and providing a signed message to be forwarded to the [Sources Registry](https://github.com/ton-blockchain/TEPs/pull/91) contract.
The signed message is stored on a source item contract as a proof that the source code compiles to a specific code cell hash.

This repo is a part of the following:

1. [contract-verifier-contracts](https://github.com/ton-community/contract-verifier-contracts) - Sources registry contracts which stores an on-chain proof per code cell hash.
2. contract-verifier-backend (this repo) - Backend for compiling FunC and returning a signature over a message containing the resulting code cell hash.
3. [contract-verifier-sdk](<(https://github.com/ton-community/contract-verifier-contracts)>) - A UI component to fetch and display sources from Ton blockchain and IPFS, including code highlighting.
4. ton-contract-verifier - A UI app to interact with the backend, contracts and publish an on-chain proof.

## Configurations

The backend supports compiling in func 0.2.0 and 0.3.0.
It ships with a static version of fiftlib (will be updated from time to time) and a fift version corresponding to the release of FunC,
hence verification response will include all 3 versions: FunC, fiftlib and fift.

## Preqrequisites

### Binaries + fiftlib

Binaries can be acquired (precompiled) from [ton-binaries](https://github.com/ton-defi-org/ton-binaries) repo or from the official [ton repo](https://github.com/ton-blockchain/ton).

#### Heroku

Currently deployed on heroku, using the [func compilation buildpack](https://github.com/ton-defi-org/heroku-buildpack-func-compiler/).

#### Locally

- Ensure you have working binaries for func 0.2.0/0.3.0 + fiftlib in this format:

```
  resources/
    binaries/
      0.2.0/fift
      0.2.0/func
      0.3.0/fift
      0.3.0/func
```

### Environment variables

- `INFURA_ID` and `INFURA_SECRET` - The backend persists sources and compilation metadata to an infura IPFS node.
- `PRIVATE_KEY` - To sign its message cell with a private key, which is verified by the [verifier registry](https://github.com/ton-blockchain/TEPs/pull/91). Provide an ED25519 compatible private key.
- `SOURCES_REGISTRY` - The address of the sources registry contract
- `VERIFIER_ID` - Sources verifier id

## Running

- `npm install`
- `npm run start`

## License

MIT
