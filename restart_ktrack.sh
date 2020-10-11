#!/bin/bash
ps -aux | grep SCREEN | grep ktrack | awk '{print $2}' | xargs -r kill
screen -d -m -S ktrack ./start.sh
