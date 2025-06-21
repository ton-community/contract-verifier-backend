const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const unzipper = require("unzipper");

function execP(command, cwd, streamFactor) {
  return new Promise((resolve, reject) => {
    const child = exec(command, { cwd: cwd || undefined }, (error, stdout, stderr) => {
      resolve(`${stdout}${stderr}`.trim());
    });

    child.stdout.on("data", (data) => {
      if (Math.random() > streamFactor) {
        console.log(data.trim());
      }
    });
  });
}

const tag = process.argv[2];

(async function () {
  if (!tag) {
    let validTags = "; source for valid tags: https://github.com/ton-blockchain/ton) ";
    try {
      validTags +=
        "Example: " +
        (
          await execP(`git ls-remote --tags https://github.com/ton-blockchain/ton.git | \
        grep -o 'refs/tags/.*' | sed 's|refs/tags/||' | sed 's/\^{}//' | \
        sort -V | tail -n 5`)
        ).replace(/\n/g, ", ");
    } catch (e) {
      console.log("nope");
    }

    throw new Error(`Usage: node prepare_ton_release.js <git_tag> ${validTags}`);
  }

  const binariesUrlBase = `https://github.com/ton-blockchain/ton/releases/download/${tag}`;

  console.log(`Downloading binaries from: ${binariesUrlBase} ...`);

  const tonSrcFolderAbs = tag;

  const workFolder = path.join(process.cwd(), "release", tag);
  await execP(`mkdir -p ${workFolder}`);
  const urls = ["fift", "func", "lite-client"].map((cmd) => [
    `${binariesUrlBase}/${cmd}-linux-x86_64`,
    cmd,
  ]);

  await Promise.all(urls.map(([url, cmd]) => execP(`curl -L ${url} > ${cmd}`, workFolder)));

  // await execP(`git checkout ${tag}`, tonSrcFolderAbs);
  // console.log(await execP(`zip -r -j ${workFolder}/fiftlib.zip crypto/fift/lib`, tonSrcFolderAbs));
  // console.log(`zip -r -j ${workFolder}/fiftlib.zip ton/crypto/fift/lib/`);

  await prepareFiftlibZip(tag, workFolder);

  console.log(`
Done!

Prepared tag: ${tag} in folder: ${workFolder}

Next steps:
1. Go to https://github.com/ton-defi-org/ton-binaries/releases
2. Draft a new release
3. Use a version name AND a tag name in the format of "ubuntu-22-[version_name]" where version_name is 0.4.6 etc.
4. Attach the binaries from the ${workFolder} folder
5. Publish the release
6. Make sure that "version_name" appears in https://github.com/ton-community/contract-verifier-config/blob/main/config.json under funcVersions
7. Redeploy to heroku
`);
})();

async function prepareFiftlibZip(tag, workFolder) {
  console.log(`Preparing fiftlib.zip ...`);

  const repo = "ton-blockchain/ton";
  const apiBase = `https://api.github.com/repos/${repo}/contents/crypto/fift/lib?ref=${tag}`;
  const rawBase = `https://raw.githubusercontent.com/${repo}/${tag}/crypto/fift/lib`;

  const res = await fetch(apiBase);
  if (!res.ok) throw new Error(`Failed to fetch file list: ${res.statusText}`);
  const files = await res.json();

  const tmpDir = "fiftlib";
  await execP(`mkdir -p ${tmpDir}`);

  await Promise.all(
    files.map(async (file) => {
      const filePath = `${tmpDir}/${file.name}`;
      await execP(`curl -sL ${rawBase}/${file.name} -o ${filePath}`);
    }),
  );

  await execP(`zip -r -j ${workFolder}/fiftlib.zip ${tmpDir}`);
}
