#!/usr/bin/env bash
# devops-engineer T-DG7-DO-D9 (F-DG7-971, ADR-0064 A5, D-278): two full transfer-drill.sh runs on one archive, modelled
# on the QA round-5 driver and qa-r5-d9-boundary-repro.sh. Run AWAY starts at $AWAY_START (UTC HH:MM:SS), chosen so the
# D7-D9 window contains no quarter hour; run QUARTER starts at $QUARTER_START, chosen so it contains one (D0-D6 took
# about 275 s in QA's runs). The archive is built from HEAD (the product is unchanged by this task; the drill and its
# helpers run from this working tree). No job is paused or rescheduled. SYNTHETIC data; approves nothing (no G1-G6,
# Finance, IT or DG approval). Run under tests/qa/support/with-pg.sh.
set -u
REPO="${DO_REPO:?}"; OUT="${DO_OUT:?}"; B="$TMPDIR/do-d9"
[ -e "$B" ] && { echo "BLOCKED: $B exists"; exit 2; }
cd "$REPO"; ts() { date -u +%T; }
echo "start $(ts); HEAD $(git rev-parse HEAD); node $(node -v); free $(df -Pm "$TMPDIR" | awk 'NR==2{print $4}') MB"
U=$(node -e 'const u=new URL(process.env.TEST_DATABASE_ADMIN_URL);u.pathname="/mth_d9_src";u.username="mth_owner";console.log(u.href)')
psql -X -q -d "$TEST_DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner LOGIN; END IF;
IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app LOGIN; END IF; END \$\$;
CREATE DATABASE mth_d9_src OWNER mth_owner ENCODING 'UTF8' TEMPLATE template0;
GRANT CONNECT ON DATABASE mth_d9_src TO mth_app;
SQL
(cd packages/db && DATABASE_OWNER_URL="$U" NODE_ENV=development node --conditions=@mth/source src/cli.ts migrate >/dev/null && \
  DATABASE_OWNER_URL="$U" NODE_ENV=development node --conditions=@mth/source src/cli.ts seed-demo | grep "reporting periods relative to") || { echo "demo db FAIL"; exit 1; }
DATABASE_OWNER_URL="$U" NODE_ENV=development node tools/migration/export.mjs --out "$B/export" --operator "transfer-drill synthetic operator" | tail -1
node tools/release/build-archive.mjs --repo "$REPO" --commit "$(git rev-parse HEAD)" --demo-data "$B/export" --out "$B/arch" | tail -1
A=$(ls "$B"/arch/*.tar.gz | head -1); S=$(sha256sum "$A" | cut -c1-64); echo "archive $(basename "$A") $(stat -c %s "$A") bytes sha256 $S"
psql -X -q -d "$TEST_DATABASE_ADMIN_URL" -c "DROP DATABASE mth_d9_src WITH (FORCE);"; rm -rf "$B/export"
mkdir -p "$B/store" && cp -a /root/.local/share/pnpm/store/v10 "$B/store/v10"
echo "ready $(ts)"
drill() { # drill <label> <start HH:MM:SS>
  local label="$1" start="$2" now tgt rc o="$OUT/out-$1"
  now=$(date -u +%s); tgt=$(date -u -d "$start" +%s)
  [ "$tgt" -gt "$now" ] && { echo "[$label] waiting $((tgt-now)) s until $start"; sleep $((tgt-now)); }
  [ "$tgt" -lt "$now" ] && echo "[$label] WARNING: start $start already passed by $((now-tgt)) s; timing differs"
  mkdir -p "$o"
  echo "[$label] transfer-drill.sh start $(ts)"
  local t0; t0=$(date +%s.%N)
  bash deploy/scripts/transfer-drill.sh --archive "$A" --sha256 "$S" --store "$B/store" --out "$o" --work "$B/work-$label" > "$o/stdout.txt" 2> "$o/stderr.txt"
  rc=$?
  echo "[$label] drill exit $rc end $(ts) wall $(node -e "console.log(($(date +%s.%N)-$t0).toFixed(1))") s"
  grep -E '^transfer-drill: (step D[0-9]+ (PASS|FAIL)|PASS|FAIL|D7: schedule|D9: )' "$o/stdout.txt" | cut -c1-260
  grep -E 'transfer-drill: D9: |is not schedule-explained|schedule rule not applicable' "$o/step-D9.log" | cut -c1-300
  grep -n "automation_" "$o/step-D9.log" | cut -c1-200
  node -e 'const r=require(process.argv[1]);const d=r.steps.find(s=>s.id==="D9");console.log("report D9 result",d.result,"recheck",d.recheck,"window",JSON.stringify(d.scheduleWindow),"listed",JSON.stringify((d.scheduleExplained||[]).map(x=>[x.executionId,x.triggerKey,x.slot,x.actionResultIds.length,x.auditEvents.length])))' "$o/transfer-drill-report.json"
  sha256sum "$o/transfer-drill-report.json" "$o/schedule-explained-d9.json" "$o/reconcile-d9.json" 2>&1
  pgrep -f "$B/work-$label/pg" >/dev/null && echo "[$label] PostgreSQL left running: YES" || echo "[$label] PostgreSQL left running: none"
  rm -rf "$B/work-$label"; echo "[$label] removed work tree"
  return $rc
}
drill away "${AWAY_START:?}"; r1=$?
drill quarter "${QUARTER_START:?}"; r2=$?
rm -rf "$B"; echo "removed $B $(ts)"
echo "away exit $r1; quarter exit $r2"
