#!/bin/bash
NODE_ENV=production npm run build
rsync -aP . ktrack.org:ktrack
ssh ktrack.org "(cd ktrack; ./restart_ktrack.sh)"
