#!/bin/bash
ps -aux | grep SCREEN | grep staging | awk '{print $2}' | xargs -r kill
screen -d -m -S staging bash ./start_staging.sh
