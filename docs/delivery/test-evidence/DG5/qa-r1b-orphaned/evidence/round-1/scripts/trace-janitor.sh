#!/usr/bin/env bash
# qa-verifier DG5 r1: disk guard for the first locale-unset product e2e run (started with the config's trace:
# retain-on-failure, whose per-context .trace/.network files accumulate in the worker's artifacts dir: ~800 MB after 70
# tests on a shared disk with 1.6 GB free). Every 60 s, deletes .trace/.network files older than 5 min (their browser
# contexts are closed; every test is < 2.5 min). Shared resources/ are kept. Logs every deletion count.
D=$1; L=$2; STOP=$3
while [ ! -f "$STOP" ]; do
  n=$(find "$D" -path '*/.playwright-artifacts-*/traces/*' \( -name '*.trace' -o -name '*.network' \) -mmin +5 2>/dev/null | wc -l)
  find "$D" -path '*/.playwright-artifacts-*/traces/*' \( -name '*.trace' -o -name '*.network' \) -mmin +5 -delete 2>/dev/null
  echo "$(date -u +%T) deleted=$n avail=$(df --output=avail -h $D | tail -1)" >> "$L"
  sleep 60
done
