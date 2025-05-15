#!/bin/bash
set -e

 if heroku whoami >/dev/null 2>&1; then
  echo "Heroku logged in as $(heroku whoami)"
else
  echo "You must run 'heroku login' first."
  exit 1
fi

if [[ $1 == "testnet" ]]; then
  values=("prod-testnet-1")
  echo "Deploying to tesnet only!"
else
  values=("prod-testnet-1" "prod-1" "prod-2" "prod-3")
fi

for heroku_app in "${values[@]}"; do
  echo "Processing heroku_app: $heroku_app"
  if ! git remote | grep "$heroku_app" >/dev/null; then
    echo "Adding remote"
    git remote add $heroku_app "https://git.heroku.com/ton-source-$heroku_app.git"
  fi
  CURR_BRANCH=$(git rev-parse --abbrev-ref HEAD)
  git push $heroku_app $CURR_BRANCH:main -f
done
