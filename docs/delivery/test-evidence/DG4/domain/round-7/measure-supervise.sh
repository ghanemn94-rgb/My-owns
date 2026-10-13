#!/usr/bin/env bash
# domain-reviewer DG4 round 7: measures the shipped worker's idle database load (pg-boss supervise interval).
# Runs INSIDE with-stack-trace.sh (WORKER=1, disposable PG 26401 / API 26402, synthetic dev seed, no probe activity).
# 1) waits 15 s for start-up to settle; 2) samples pg_stat_database (db mth) xact_commit and the worker's CPU ticks over
# 20 s with the worker running; 3) SIGSTOPs the worker and samples the same 20 s again as the baseline (API idle only);
# 4) SIGCONTs the worker. Also lists the worker's statements seen in pg_stat_activity during phase 2.
set -u
cd "$TMPDIR/review-dom7"
WK=""
for p in $(pgrep -f "apps/worker/dist/main.js"); do
  [ "$(readlink /proc/$p/cwd)" = "$TMPDIR/review-dom7" ] && WK=$p
done
echo "worker pid: ${WK:-NOT FOUND}"; [ -z "$WK" ] && exit 2
q() { psql "$PSQL_MTH" -qAtc "$1"; }
ticks() { awk '{print $14+$15}' /proc/$WK/stat; }
sleep 15
sample() {
  local label=$1
  local c0 t0 c1 t1
  q "select pg_stat_clear_snapshot()" >/dev/null
  c0=$(q "select xact_commit+xact_rollback from pg_stat_database where datname='mth'"); t0=$(ticks)
  local seen=""
  for _ in $(seq 1 20); do
    sleep 1
    seen+=$(q "select left(regexp_replace(query,'\s+',' ','g'),90) from pg_stat_activity where datname='mth' and application_name='mth-worker' and state='active'")$'\n'
  done
  c1=$(q "select xact_commit+xact_rollback from pg_stat_database where datname='mth'"); t1=$(ticks)
  echo "[$label] db mth transactions in 20 s: $((c1-c0)) ($(( (c1-c0)/20 ))/s); worker CPU ticks (utime+stime, 1/100 s) in 20 s: $((t1-t0))"
  echo "[$label] distinct active worker statements sampled 1/s:"; printf '%s' "$seen" | grep -v '^$' | sort | uniq -c | sort -rn | head -8
}
sample "worker running"
kill -STOP $WK
sample "worker SIGSTOPped (baseline)"
kill -CONT $WK
echo "worker application_name connections: $(q "select count(*) from pg_stat_activity where application_name='mth-worker'")"
exit 0
