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
    if [ "$1" = "set_config" ]; then
      echo "Setting config"
      priv_key_var=PRIVATE_KEY_$(echo $heroku_app | sed 's/-/_/g')
      priv_key=${!priv_key_var}
      heroku config:set --remote $heroku_app PRIVATE_KEY=$priv_key INFURA_ID=$INFURA_ID INFURA_SECRET=$INFURA_SECRET NPM_CONFIG_PRODUCTION=$NPM_CONFIG_PRODUCTION TS_NODE_PROJECT=$TS_NODE_PROJECT YARN_PRODUCTION=$YARN_PRODUCTION
      heroku config:set --remote $heroku_app VERIFIER_ID=orbs-test
      heroku buildpacks:clear --remote $heroku_app 
      heroku buildpacks:add --remote $heroku_app https://github.com/ton-defi-org/heroku-buildpack-func-compiler.git
      heroku buildpacks:add --remote $heroku_app heroku/nodejs
      heroku stack:set heroku-18 --remote $heroku_app
    elif [ "$1" = "deploy" ]; then
      if ! git remote | grep "$heroku_app" > /dev/null; then
        echo "Adding remote"
        git remote add $heroku_app "https://git.heroku.com/ton-source-$heroku_app.git"
      fi
      CURR_BRANCH=`git rev-parse --abbrev-ref HEAD`
      git push $heroku_app $CURR_BRANCH:main -f
    else
      echo "No valid command" && exit 1;
    fi
done