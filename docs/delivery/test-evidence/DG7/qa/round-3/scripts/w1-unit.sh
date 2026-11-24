#!/usr/bin/env bash
# qa-verifier DG7 round 3, wave 1a (rv, after 10-build): unit tests twice (locale unset; C.UTF-8). Restarted at 2 h
# limit after the first background launch was stopped at the 30-min default (disclosed; killed logs kept as *-killed).
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-3/scripts
R="bash $S/run.sh"
$R 20-unit-node24-unset env -u LANG -u LC_ALL -u LC_CTYPE pnpm test
$R 21-unit-node24-cutf8 env LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test
echo "w1-unit done $(date -u +%FT%TZ)"
