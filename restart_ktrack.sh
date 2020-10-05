#!/bin/bash
ps -aux | grep SCREEN | grep ktrack | awk '{print $2}' | xargs kill
screen -d -m -S ktrack ./start.sh
