#!/bin/bash
set -e

if [ ! -f ".secret" ]; then
    >&2 echo "Error: .secret does not exist."
    exit 1
fi
source .secret

values=("prod-1" "prod-2" "prod-3")

for heroku_app in "${values[@]}"; do
    echo "Processing heroku_app: $heroku_app"
    echo "Setting config"
      priv_key_var=PRIVATE_KEY_$(echo $heroku_app | sed 's/-/_/g')
      priv_key=${!priv_key_var}
      heroku config:set --remote $heroku_app PRIVATE_KEY=$priv_key TACT_DEPLOYER_INFURA_ID=$TACT_DEPLOYER_INFURA_ID TACT_DEPLOYER_INFURA_SECRET=$TACT_DEPLOYER_INFURA_SECRET INFURA_ID=$INFURA_ID INFURA_SECRET=$INFURA_SECRET NPM_CONFIG_PRODUCTION=$NPM_CONFIG_PRODUCTION TS_NODE_PROJECT=$TS_NODE_PROJECT YARN_PRODUCTION=$YARN_PRODUCTION

      if [ "$1" = "test" ]; then
        heroku config:set --remote $heroku_app VERIFIER_ID=orbs-test ALLOW_FIFT=1
      else
        heroku config:unset --remote $heroku_app ALLOW_FIFT VERIFIER_ID
      fi
      
      heroku buildpacks:clear --remote $heroku_app 
      heroku buildpacks:add --remote $heroku_app https://github.com/ton-defi-org/heroku-buildpack-func-compiler.git
      heroku buildpacks:add --remote $heroku_app heroku/nodejs
      heroku stack:set heroku-22 --remote $heroku_app
done