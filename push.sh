#!/bin/bash
npm run build
rsync -av --delete --exclude /data --exclude /today --exclude /favorites --exclude /history --exclude /profile --exclude /.git . ktrack.org:ktrack
ssh ktrack.org "(cd ktrack; cp -r build/client/* /var/www/ktrack/; ./restart_ktrack.sh)"
