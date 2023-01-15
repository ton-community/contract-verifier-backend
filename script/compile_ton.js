const { exec } = require("child_process");

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

const tags = ["func-0.4.0", "func-0.3.0", "func-0.2.0"];

(async function () {
  for (const tag of tags) {
    await execP("rm -rf build; mkdir build");

    await execP(`git checkout ${tag}`, "ton");

    const output = await execP(`cmake -DCMAKE_BUILD_TYPE=Release ../ton`, "build");
    if (!/Build files have been written to/.test(output)) {
      throw new Error("CMake failed");
    }

    console.log("CMake done. building func");
    const output2 = await execP(
      `cmake --build . -j16 --target fift func lite-client`,
      "build",
      0.9,
    );

    console.log(output2);

    if (
      !output2.includes("Built target fift") ||
      !output2.includes("Built target func") ||
      !output2.includes("Built target lite-client")
    ) {
      throw new Error("Build fift/func/lite-client failed");
    }

    await execP(`mkdir -p binaries/${tag}; cp build/crypto/func binaries/${tag}/func; 
    cp build/crypto/fift binaries/${tag}/fift; cp build/lite-client/lite-client binaries/${tag}/lite-client; zip -r -j binaries/${tag}/fiftlib.zip ton/crypto/fift/lib/`);

    console.log("Done with " + tag);
  }
})();
