#!/usr/bin/env bash
# domain-reviewer DG4 round 7 (F-DG4-128 verification, adversarial): start the BUILT worker (apps/worker/dist/main.js, the
# shipped entry point) with a range of WORKER_SUPERVISE_INTERVAL_SECONDS values. Runs INSIDE with-stack.sh (WORKER=0) so
# DATABASE_URL points at the disposable PostgreSQL. For each value: run for up to 6 s under --trace-warnings, then SIGTERM.
# Records exit code, whether "mth-worker started" was logged (with the cadence it reports), any TimeoutNaNWarning, and the
# first config error line. Expected: invalid values -> refuse to start (non-zero exit, names the variable, no "started");
# unset/empty -> 60; valid integers 1..600 -> honoured.
set -u
cd "$TMPDIR/review-dom7"
run() {
  local label=$1; shift
  local out; out=$(mktemp "$TMPDIR/wk.XXXX")
  ( exec env "$@" node --trace-warnings apps/worker/dist/main.js ) > "$out" 2>&1 &
  local pid=$!
  local started=0
  for _ in $(seq 1 30); do sleep 0.2; grep -q '"mth-worker started"' "$out" && { started=1; break; }; kill -0 $pid 2>/dev/null || break; done
  [ $started = 1 ] && sleep 2 && kill -TERM $pid 2>/dev/null
  wait $pid; local code=$?
  local cadence; cadence=$(grep -o '"superviseIntervalSeconds":[0-9]*' "$out" | head -1)
  local nan; nan=$(grep -c 'TimeoutNaNWarning' "$out")
  local err; err=$(grep -m1 -o 'WORKER_SUPERVISE_INTERVAL_SECONDS[^"]*' "$out" | head -1)
  printf '%-34s exit=%-3s started=%s cadence=%-30s NaNWarnings=%s err=%s\n' "$label" "$code" "$started" "${cadence:-none}" "$nan" "${err:-none}"
  rm -f "$out"
}
run "unset (shipped default)" -u WORKER_SUPERVISE_INTERVAL_SECONDS
for v in "" " " "60" "1" "600" "17" "0" "601" "-5" "1.5" "abc" "NaN" "Infinity" "60s" "1e2" "0x3C" " 60 "; do
  run "value='$v'" WORKER_SUPERVISE_INTERVAL_SECONDS="$v"
done
run "NODE_ENV=production, unset" -u WORKER_SUPERVISE_INTERVAL_SECONDS NODE_ENV=production
run "NODE_ENV=production, 'abc'" NODE_ENV=production WORKER_SUPERVISE_INTERVAL_SECONDS=abc
exit 0
