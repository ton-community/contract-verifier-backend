const execSync = require("child_process").execSync;

const config = require("../secrets-config.json");

for (const network of ["testnet", "mainnet"]) {
  for (const node of Object.keys(config[network].nodes)) {
    const env = Object.entries(config.shared.env);
    env.push(...Object.entries(config[network].env));
    env.push(...Object.entries(config[network].nodes[node].env));

    const cmd = `heroku config:set --remote ${node} ${env
      .map(([key, val]) => `${key}=${val}`)
      .join(" ")}`;

    let res = execSync(cmd);
    console.log(res.toString());

    res = execSync(`
    heroku buildpacks:clear --remote ${node};
      heroku buildpacks:add --remote ${node} https://github.com/ton-defi-org/heroku-buildpack-func-compiler.git;
      heroku buildpacks:add --remote ${node} heroku/nodejs;
      heroku stack:set heroku-22 --remote ${node};`);

    console.log(res.toString());
  }
}
