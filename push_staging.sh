#!/bin/bash
npm run build
#rsync -av --delete --exclude .svelte-kit --exclude /data --exclude /today --exclude /favorites --exclude /history --exclude /profile --exclude /.git . ktrack.org:staging
rsync -av --delete --exclude /data --exclude /.git . ktrack.org:staging
ssh ktrack.org "(cd staging; ./restart_staging_ktrack.sh)"
