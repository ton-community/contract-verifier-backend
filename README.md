# contract-verifier-backend
A backend used for compiling FunC code and providing a signed message to be forwarded to the [Sources Registry](https://github.com/ton-blockchain/TEPs/pull/91) contract.
The signed message is stored on a source item contract as a proof that the source code compiles to a specific code cell hash.

## Configurations
The backend supports compiling in func 0.2.0 and 0.3.0.
(TODO address fiftlib/fift versions)

## Preqrequisites

### Binaries + fiftlib
Binaries can be acquired (precompiled) from [ton-binaries](https://github.com/ton-defi-org/ton-binaries) repo or from the official [ton repo](https://github.com/ton-blockchain/ton).

#### Production 
Currently deployed on heroku, using the [func compilation buildpack](https://github.com/ton-defi-org/heroku-buildpack-func-compiler/).

####  Locally
* Ensure you have working binaries for func 0.2.0/0.3.0 + fiftlib in this format:
```
  resources/
    binaries/
      0.2.0/fift
      0.2.0/func
      0.3.0/fift
      0.3.0/func
    fiftlib/
      Asm.fif
      ..
```

### Environment variables
* `INFURA_ID` and `INFURA_SECRET` - The backend persists sources and compilation metadata to an infura IPFS node.
* `PRIVATE_KEY` - To sign its message cell with a private key, which is verified by the [verifier registry](https://github.com/ton-blockchain/TEPs/pull/91).
Provide an ED25519 compatible private key in the `PRIVATE_KEY` env var.
* `SOURCES_REGISTRY` - The address of the sources registry contract
* `VERIFIER_ID` - Sources verifier id

## Running
* `npm install`
* `npm run start`

## License
MIT
