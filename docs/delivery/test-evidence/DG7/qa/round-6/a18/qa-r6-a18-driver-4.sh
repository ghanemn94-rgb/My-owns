#!/usr/bin/env bash
# qa-verifier DG7 round 6 (T-DG7-REV-QA-R6), attempt 4 (driver-3 with probe ports 32598/32599, a second instance staggered later): two staggered transfer-drill.sh --keep runs on one archive from
# the FROZEN clone (830d7edf, candidate 0b481627), started at $QA_START_A and $QA_START_B so that one D7-D9 window
# should contain the 14:00 quarter hour (attempts 1 and 2 missed 13:00 and 13:30 by the D0 build-time variance). Each
# kept target then gets kept-target-probes.sh (own port). No job is paused or rescheduled; nothing in the candidate is
# changed. SYNTHETIC data only; approves nothing (no G1-G6, Finance, IT or DG approval). Run under with-pg.sh.
set -u
REPO="${QA_REPO:?}"; OUT="${QA_OUT:?}"; B="${QA_B:?}"; CAND=sha256:0b48162701518d1fb47789282112f2d5528429e77d6f108d3f8696570f06bc95
HERE="$(cd "$(dirname "$0")" && pwd)"
[ -e "$B" ] && { echo "BLOCKED: $B exists"; exit 2; }
cd "$REPO"; ts() { date -u +%T; }
free() { df -Pm "$TMPDIR" | awk 'NR==2{print $4}'; }
waituntil() { local now tgt; now=$(date -u +%s); tgt=$(date -u -d "$1" +%s); [ "$tgt" -gt "$now" ] && { echo "waiting $((tgt-now)) s until $1"; sleep $((tgt-now)); }; true; }
echo "start $(ts); HEAD $(git rev-parse HEAD); node $(node -v); free $(free) MB"
U=$(node -e 'const u=new URL(process.env.TEST_DATABASE_ADMIN_URL);u.pathname="/mth_a18_src";u.username="mth_owner";console.log(u.href)')
psql -X -q -d "$TEST_DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner LOGIN; END IF;
IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app LOGIN; END IF; END \$\$;
CREATE DATABASE mth_a18_src OWNER mth_owner ENCODING 'UTF8' TEMPLATE template0;
GRANT CONNECT ON DATABASE mth_a18_src TO mth_app;
SQL
(cd packages/db && DATABASE_OWNER_URL="$U" NODE_ENV=development node --conditions=@mth/source src/cli.ts migrate >/dev/null && \
  DATABASE_OWNER_URL="$U" NODE_ENV=development node --conditions=@mth/source src/cli.ts seed-demo | grep "reporting periods relative to") || { echo "demo db FAIL"; exit 1; }
DATABASE_OWNER_URL="$U" NODE_ENV=development node tools/migration/export.mjs --out "$B/export" --operator "transfer-drill synthetic operator" | tail -1
node tools/release/build-archive.mjs --repo "$REPO" --commit "$(git rev-parse HEAD)" --demo-data "$B/export" --candidate $CAND --out "$B/arch" | tail -1
A=$(ls "$B"/arch/*.tar.gz | head -1); S=$(sha256sum "$A" | cut -c1-64); echo "archive $(basename "$A") sha256 $S"
psql -X -q -d "$TEST_DATABASE_ADMIN_URL" -c "DROP DATABASE mth_a18_src WITH (FORCE);"; rm -rf "$B/export"
mkdir -p "$B/store" && cp -a "${QA_STORE_SRC:?}" "$B/store/v10"
drill() { # $1 tag, $2 start
  waituntil "$2"; mkdir -p "$OUT/$1"
  echo "[$1] transfer-drill.sh --keep start $(ts)"
  bash deploy/scripts/transfer-drill.sh --archive "$A" --sha256 "$S" --store "$B/store" --out "$OUT/$1" --work "$B/work-$1" --keep > "$OUT/$1/stdout.txt" 2> "$OUT/$1/stderr.txt"
  echo "[$1] drill exit $? $(ts)"
}
drill a "${QA_START_A:?}" > "$OUT/drill-a.log" 2>&1 &
PA=$!
drill b "${QA_START_B:?}" > "$OUT/drill-b.log" 2>&1 &
PB=$!
wait $PA $PB
for t in a b; do
  echo "=== drill $t"; cat "$OUT/drill-$t.log"
  grep -E '^transfer-drill: (step D[0-9]+ (PASS|FAIL)|PASS|FAIL)' "$OUT/$t/stdout.txt" | cut -c1-200
  grep -hE 'transfer-drill: D[79]: |is not schedule-explained|schedule rule not applicable|step D9 failed' "$OUT/$t/step-D7.log" "$OUT/$t/step-D9.log" 2>/dev/null | cut -c1-400
  node -e 'const r=require(process.argv[1]);const d=r.steps.find(s=>s.id==="D9");console.log("report result",r.result,"| D9",d.result,"recheck",d.recheck,"window",JSON.stringify(d.scheduleWindow),"| listed",JSON.stringify((d.scheduleExplained||[]).map(x=>[x.executionId,x.triggerKey,x.slot,x.status,x.createdAt,x.actionResultIds.length,x.auditEvents.length])))' "$OUT/$t/transfer-drill-report.json" 2>&1
  echo "stderr lines: $(wc -l < "$OUT/$t/stderr.txt")"; head -5 "$OUT/$t/stderr.txt"
  cp "$B/work-$t/reconcile-d9.txt" "$OUT/$t/reconcile-d9.txt" 2>/dev/null
  echo "--- [$t] kept-target probes start $(ts)"
  port=32598; [ "$t" = b ] && port=32599
  QA_W="$B/work-$t" QA_P1="$OUT/$t" QA_PROBE_OUT="$OUT/probes-$t" QA_PROBE_PORT=$port bash "$HERE/kept-target-probes.sh"
  echo "[$t] kept-target probes exit $? $(ts)"
done
pgrep -f "$B/work" >/dev/null && echo "drill PostgreSQL left running: YES" || echo "drill PostgreSQL left running: none"
rm -rf "$B"; echo "removed $B $(ts)"
exit 0
