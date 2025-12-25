import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const CHAINSTACK_API_KEY = process.env.CHAINSTACK_API_KEY;
const CHAINSTACK_BUCKET_ID = process.env.CHAINSTACK_BUCKET_ID;
const CHAINSTACK_API_URL = "https://api.chainstack.com/v1/ipfs/pins/pinfile";

type ChainstackUploadResponse = {
  id: string;
  cid: string;
  type: string;
  title: string;
  status: string;
  size: number;
  public_link: string;
};

async function testUpload() {
  console.log("========================================");
  console.log("Chainstack IPFS Upload Test");
  console.log("========================================\n");

  if (!CHAINSTACK_API_KEY || !CHAINSTACK_BUCKET_ID) {
    console.error("❌ Missing environment variables:");
    console.error(`   CHAINSTACK_API_KEY: ${CHAINSTACK_API_KEY ? "✓ set" : "✗ missing"}`);
    console.error(`   CHAINSTACK_BUCKET_ID: ${CHAINSTACK_BUCKET_ID ? "✓ set" : "✗ missing"}`);
    process.exit(1);
  }

  console.log(`API Key: ${CHAINSTACK_API_KEY.slice(0, 8)}...${CHAINSTACK_API_KEY.slice(-4)}`);
  console.log(`Bucket ID: ${CHAINSTACK_BUCKET_ID}\n`);

  const testContent = `Hello from Chainstack IPFS test! Timestamp: ${new Date().toISOString()}`;

  console.log("Uploading test content...");
  console.log(`Content: "${testContent}"\n`);

  try {
    const formData = new FormData();
    formData.append("bucket_id", CHAINSTACK_BUCKET_ID);
    formData.append("file", new Blob([testContent]), "test-file.txt");

    const response = await fetch(CHAINSTACK_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CHAINSTACK_API_KEY}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result: ChainstackUploadResponse = await response.json();

    console.log("✅ Upload successful!");
    console.log(`   ID: ${result.id}`);
    console.log(`   CID: ${result.cid}`);
    console.log(`   Size: ${result.size} bytes`);
    console.log(`   Status: ${result.status}`);
    console.log(`   Public Link: ${result.public_link}`);
    console.log(`\n   View at: https://ipfs.io/ipfs/${result.cid}`);
  } catch (error: any) {
    console.error("❌ Upload failed!");
    console.error(`   Error: ${error.message}`);
    process.exit(1);
  }
}

testUpload();
