const { exec } = require("child_process");
const path = require("path");

function execP(command, cwd, streamFactor) {
  return new Promise((resolve, reject) => {
    const child = exec(command, { cwd: cwd || undefined }, (error, stdout, stderr) => {
      // if (error) {
      //   reject(error);
      //   return;
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
const tonSrcFolderAbs = process.argv[3];

if (!tag || !tonSrcFolderAbs) {
  throw new Error("Usage: node prepare_ton_release.js <tag> <folder>");
}

(async function () {
  const workFolder = path.join(process.cwd(), "release", tag);
  await execP(`mkdir -p ${workFolder}`);
  const urls = ["fift", "func", "lite-client"].map((cmd) => [
    `https://github.com/ton-blockchain/ton/releases/download/${tag}/${cmd}-linux-x86_64`,
    cmd,
  ]);

  await Promise.all(urls.map(([url, cmd]) => execP(`curl -L ${url} > ${cmd}`, workFolder)));

  await execP(`git checkout ${tag}`, tonSrcFolderAbs);
  console.log(await execP(`zip -r -j ${workFolder}/fiftlib.zip crypto/fift/lib`, tonSrcFolderAbs));
  console.log(`zip -r -j ${workFolder}/fiftlib.zip ton/crypto/fift/lib/`);

  console.log("Done with " + tag);
})();
