#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
export BODY_SIZE_LIMIT=10485760 # 10 MB
while true
do
npm run start_staging
done
