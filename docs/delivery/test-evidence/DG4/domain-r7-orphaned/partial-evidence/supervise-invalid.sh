#!/usr/bin/env bash
# domain-reviewer DG4 round 7 (F-DG4-128 re-verification): runs INSIDE with-stack.sh (disposable PG 26401 / API 26402,
# synthetic dev seed). Starts the BUILT worker (apps/worker/dist/main.js, node --trace-warnings) with
# WORKER_SUPERVISE_INTERVAL_SECONDS set to out-of-range / non-numeric values and expects it to refuse to start (exit 78,
# names the variable, never logs "mth-worker started"). Then the accepted boundaries (empty -> default 60, 1, 600) must
# start without TimeoutNaNWarning and log the cadence; they are stopped with SIGTERM after 4 s.
set -u
cd "$TMPDIR/review-dom"
rc=0
for v in 0 601 1.5 abc -5 " " 1e9 0x3C; do
  out=$(WORKER_SUPERVISE_INTERVAL_SECONDS="$v" timeout 30 node --trace-warnings apps/worker/dist/main.js 2>&1); s=$?
  started=$(printf '%s' "$out" | grep -c "mth-worker started")
  echo "[refuse] value='$v' exit=$s started_lines=$started output=$(printf '%s' "$out" | head -c 240 | tr '\n' ' ')"
  if [ "$s" != 78 ] || [ "$started" != 0 ]; then echo "  -> NOT REFUSED"; [ "$v" = "0x3C" ] || [ "$v" = " " ] || rc=1; fi
done
for v in "" 1 600; do
  L=$(mktemp "$TMPDIR/wk.XXXX")
  WORKER_SUPERVISE_INTERVAL_SECONDS="$v" node --trace-warnings apps/worker/dist/main.js > "$L" 2>&1 & P=$!
  sleep 4; kill -TERM $P; wait $P; s=$?
  nan=$(grep -c "TimeoutNaNWarning" "$L"); line=$(grep -o '"msg":"mth-worker started"[^}]*' "$L" | head -1)
  echo "[accept] value='$v' exit_after_SIGTERM=$s TimeoutNaNWarning=$nan started=$line"
  if [ "$nan" != 0 ] || [ -z "$line" ] || [ "$s" != 0 ]; then echo "  -> UNEXPECTED"; rc=1; fi
  rm -f "$L"
done
echo "### supervise-invalid exit=$rc"
exit $rc
