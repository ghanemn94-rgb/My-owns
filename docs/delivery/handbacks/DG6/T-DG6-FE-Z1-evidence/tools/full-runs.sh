#!/usr/bin/env bash
# T-DG6-FE-Z1: the full product e2e (apps/web/e2e), both projects x both locale settings, four stacks in
# parallel plus one CPU spinner per core, as the review's load. Run from the repository root.
# usage: full-runs.sh <evidence dir> <tag>
set -u
EV="$1"; TAG="$2"; OUT="${TMPDIR:?}/fez1-$TAG"; mkdir -p "$OUT"
NCPU=$(nproc); SPIN=()
for _ in $(seq "$NCPU"); do (while :; do :; done) & SPIN+=($!); done
cleanup() { kill "${SPIN[@]}" "$SAMPLER" 2>/dev/null; }
trap cleanup EXIT
( while :; do echo "$(date -u +%FT%TZ) load=$(cut -d' ' -f1-3 /proc/loadavg)"; sleep 60; done ) > "$EV/$TAG-load.log" & SAMPLER=$!
echo "spinners: ${#SPIN[@]} (pids ${SPIN[*]})" > "$EV/$TAG-spinners.txt"
run() { # idx locale project
  local i=$1 loc=$2 proj=$3 log="$EV/$TAG-$2-$3.log" base=$((29100 + 10 * $1))
  {
    echo "\$ apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --project=$proj --workers=1 --reporter=list --output=\$TMPDIR/fez1-$TAG/$loc-$proj ($(date -u +%FT%TZ)) node=$(node -v) LANG=${loc/unset/<unset>} load=$(cut -d' ' -f1-3 /proc/loadavg)"
    if [ "$loc" = unset ]; then
      env -u LANG -u LC_ALL -u LANGUAGE -u LC_CTYPE E2E_PG_PORT=$base E2E_API_PORT=$((base + 1)) MTH_PORT_POOL=$((base + 2))-$((base + 9)) \
        apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --project="$proj" --workers=1 --reporter=list --output="$OUT/$loc-$proj"
    else
      LANG=C.UTF-8 LC_ALL=C.UTF-8 E2E_PG_PORT=$base E2E_API_PORT=$((base + 1)) MTH_PORT_POOL=$((base + 2))-$((base + 9)) \
        apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --project="$proj" --workers=1 --reporter=list --output="$OUT/$loc-$proj"
    fi
    echo "EXIT $? ($(date -u +%FT%TZ)) load=$(cut -d' ' -f1-3 /proc/loadavg)"
  } > "$log" 2>&1
}
run 0 unset chromium-en & P0=$!
run 1 unset chromium-ar & P1=$!
run 2 cutf8 chromium-en & P2=$!
run 3 cutf8 chromium-ar & P3=$!
wait $P0 $P1 $P2 $P3
grep -H '^EXIT' "$EV/$TAG"-*-chromium-*.log
