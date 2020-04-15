#!/bin/bash
NODE_ENV=production npm run build
rsync -av --exclude today --exclude favorites --exclude history --exclude profile . ktrack.org:ktrack
ssh ktrack.org "(cd ktrack; ./restart_ktrack.sh)"
