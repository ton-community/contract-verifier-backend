# CID Extraction Script

This script fetches all IPFS CIDs for verified contracts from the TON blockchain.

## Purpose

When migrating IPFS providers, you need to know all the CIDs that have been stored on-chain. This script:

- Queries all Source Item contract deployments from the Sources Registry
- Extracts IPFS CIDs for your verifier ID
- Optionally fetches metadata from IPFS
- Outputs both a detailed JSON file and a simple CID list

## Environment Variables

### Required

- `VERIFIER_ID` - Your verifier identifier (e.g., `orbs.com`)
- `IPFS_PROVIDER` - IPFS gateway domain for fetching metadata (e.g., `tonsource.infura-ipfs.io`)
- `SOURCES_REGISTRY` - Sources registry contract address (e.g., `EQD-BJSVUJviud_Qv7Ymfd3qzXdrmV525e3YDzWQoHIAiInL`)

### Optional

- `RPC_URL` - Custom RPC endpoint URL for fetching transactions (defaults to TONCenter API)
  - Example: `https://toncenter.com/api/v3/actions`
  - Example with custom provider: `https://my-ton-node.com/api/v3/actions`
- `NETWORK` - Set to `testnet` for testnet (defaults to mainnet)

## Usage

### 1. Set up environment variables

Create a `.env` file or use `.env.local`:

```bash
VERIFIER_ID=orbs.com
IPFS_PROVIDER=tonsource.infura-ipfs.io
SOURCES_REGISTRY=EQD-BJSVUJviud_Qv7Ymfd3qzXdrmV525e3YDzWQoHIAiInL

# Optional: Use custom RPC endpoint
RPC_URL=https://toncenter.com/api/v3/actions

# For upload functionality
NEW_INFURA_ID=your_new_infura_project_id
NEW_INFURA_SECRET=your_new_infura_project_secret
NEW_IPFS_URL=https://ipfs.infura.io:5001/api/v0  # Optional, defaults to Infura
```

### 2. Run the script

**Extract CIDs only (no download):**

```bash
npm run fetch-cids
```

**Download CIDs to `cids/` folder:**

```bash
npm run fetch-cids -- --download
```

**Download and upload to new IPFS provider:**

```bash
npm run fetch-cids -- --upload
```

Or directly with ts-node:

```bash
# Extract only
ts-node --transpile-only script/fetch-all-cids.ts

# Download
ts-node --transpile-only script/fetch-all-cids.ts --download

# Upload
ts-node --transpile-only script/fetch-all-cids.ts --upload
```

## Output Files

The script generates several files in the project root:

### 1. `extracted-cids.json`

Detailed JSON with full metadata:

```json
[
  {
    "sourceItemAddress": "EQAbc...",
    "codeCellHash": "te6ccgE...",
    "ipfsCID": "QmXyz...",
    "ipfsLink": "ipfs://QmXyz...",
    "verifierId": "orbs.com",
    "timestamp": 1234567890,
    "sourceData": {...},
    "sourceFileCIDs": ["QmAbc...", "QmDef..."]
  }
]
```

### 2. `all-cids.csv`

CSV with all CIDs (metadata + source files):

```csv
type,cid,sourceItemAddress,codeCellHash,timestamp,filename,compiler
metadata,QmXyz...,EQAbc...,te6ccgE...,2024-01-15T10:30:00.000Z,,func
source_file,QmAbc...,EQAbc...,te6ccgE...,2024-01-15T10:30:00.000Z,contract.fc,func
source_file,QmDef...,EQAbc...,te6ccgE...,2024-01-15T10:30:00.000Z,stdlib.fc,func
```

### 3. `cids-only.txt`

Metadata CIDs only (one per line):

```
QmXyz123...
QmAbc456...
```

### 4. `all-unique-cids.txt`

All unique CIDs including source files (sorted):

```
QmAbc456...
QmDef789...
QmXyz123...
```

### 5. `cids/` folder (with `--download` or `--upload`)

Downloaded CID content stored as `cids/{cid}`:

```
cids/
  QmXyz123.../
  QmAbc456.../
  QmDef789.../
```

## Migration Use Cases

### Automated Migration (Recommended)

Use the built-in `--upload` flag to automatically download and upload to new provider:

```bash
# Set new provider credentials in .env
NEW_INFURA_ID=your_new_project_id
NEW_INFURA_SECRET=your_new_project_secret

# Run migration
npm run fetch-cids -- --upload
```

This will:

1. Extract all CIDs from blockchain
2. Download each CID from old provider
3. Upload to new provider (with CID verification)
4. Save all content to `cids/` folder

### Manual Migration

Use the `all-unique-cids.txt` file to manually re-pin:

```bash
# Example: Pin all CIDs to local IPFS node
while read cid; do
  ipfs pin add "$cid"
done < all-unique-cids.txt
```

Or with Pinata/Infura API:

```bash
while read cid; do
  curl -X POST "https://api.pinata.cloud/pinning/pinByHash" \
    -H "Authorization: Bearer YOUR_JWT" \
    -H "Content-Type: application/json" \
    -d "{\"hashToPin\":\"$cid\"}"
done < all-unique-cids.txt
```

### Upload from Downloaded Files

If you already downloaded with `--download`, you can upload later:

```bash
# Upload all files in cids/ folder
for file in cids/*; do
  cid=$(basename "$file")
  ipfs add --cid-version 0 "$file" --pin
done
```

## How It Works

1. **Fetch deployments**: Queries the TON blockchain for all Source Item contract deployments using the configured RPC endpoint
2. **Filter by verifier**: Only includes contracts verified by your verifier ID
3. **Extract CIDs**: Reads the IPFS link from each Source Item's on-chain data
4. **Fetch metadata**: Fetches the source specification JSON from IPFS
5. **Extract source file CIDs**: Parses the metadata to extract individual source file CIDs
6. **Output files**: Saves JSON, CSV, and text files with all CIDs
7. **Download (optional)**: Downloads all unique CIDs to `cids/` folder
8. **Upload (optional)**: Uploads downloaded content to new IPFS provider with CID verification

## Performance Notes

- The script fetches transactions in batches of 100
- Includes 1-second delay between transaction batches to avoid rate limiting
- IPFS metadata fetches have a 5-second timeout
- IPFS downloads have a 10-second timeout
- Download/upload includes 0.5-second delay between CIDs
- Failed IPFS operations are logged but don't stop execution
- CID verification ensures uploaded content matches original

## Troubleshooting

### "No Firebase env vars found"

This is expected - Firebase is not required for CID extraction.

### "Unable to fetch IPFS data"

The script continues even if IPFS metadata can't be fetched. The CID is still extracted from the blockchain.

### Rate limiting

If you hit rate limits, you can:

- Set a custom `RPC_URL` with higher limits
- Increase the delay between batches in the script
- Use your own TON node

## Example Output

```
========================================
CID Extraction Script
========================================

Starting CID extraction...
Verifier ID: orbs.com
Verifier SHA256: 1a2b3c...
Sources Registry: EQD-BJSVUJviud_Qv7Ymfd3qzXdrmV525e3YDzWQoHIAiInL
IPFS Provider: tonsource.infura-ipfs.io
RPC URL: default (toncenter)

Fetching batch starting at offset 0...
Found 100 source item deployments
✓ Extracted CID: QmXyz... from EQAbc...
  Code hash: te6ccgE...
  Timestamp: 2024-01-15T10:30:00.000Z

...

Total CIDs extracted: 250

✓ Saved 250 CID records to: /path/to/extracted-cids.json
✓ Saved CIDs list to: /path/to/cids-only.txt

========================================
Summary
========================================
Total CIDs found: 250
Verifier ID: orbs.com
Network: mainnet

By Compiler:
  func: 180
  tolk: 40
  tact: 30

✓ Done!
```
