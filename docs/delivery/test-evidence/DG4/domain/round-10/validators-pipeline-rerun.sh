#!/usr/bin/env bash
# domain-reviewer DG4 round 10: re-run of the one validator command that validators.sh did not finish (stopped by my own
# 10-minute background limit): --pipeline on the repository working tree (HEAD 01a801e).
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:/usr/bin:/bin
cd /home/user/My-owns; echo "### repo HEAD $(git rev-parse HEAD) $(date -u +%FT%TZ) load=$(cut -d' ' -f1-3 /proc/loadavg)"
node tools/gates/validate.mjs --pipeline 2>&1 | tail -15; echo "### exit=${PIPESTATUS[0]} $(date -u +%FT%TZ) load=$(cut -d' ' -f1-3 /proc/loadavg)"
