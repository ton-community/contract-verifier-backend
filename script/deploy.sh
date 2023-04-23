#!/bin/bash
set -e

if [ ! -f ".secret" ]; then
  echo >&2 "Error: .secret does not exist."
  exit 1
fi
source .secret

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
