#!/usr/bin/env bash
# Samples /proc/loadavg every 15 s until killed or <seconds> pass. usage: sample.sh <log> <seconds>
end=$(( $(date +%s) + $2 ))
while [ "$(date +%s)" -lt "$end" ]; do echo "$(date -u +%H:%M:%S) $(cut -d' ' -f1-3 /proc/loadavg)" >>"$1"; sleep 15; done
