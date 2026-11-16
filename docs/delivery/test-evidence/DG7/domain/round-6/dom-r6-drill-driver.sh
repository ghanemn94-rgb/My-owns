#!/usr/bin/env bash
# domain-reviewer DG7 round 6 (T-DG7-REV-DOM-R6): independent transfer-drill.sh runs on an archive built from the FROZEN
# source commit 830d7edfd in a disposable clone. QUARTER run timed so the D7-D9 window spans a quarter hour (the
# */15 approval.escalation_scan slot), AWAY run timed so it spans none. --keep on the QUARTER run so the target cluster
# can be probed afterwards (adversarial re-run of schedule-explained.mjs). Run under tests/qa/support/with-pg.sh.
# No job is paused or rescheduled. SYNTHETIC data; approves nothing (no G1-G6, Finance, IT or DG approval).
set -u
REPO="${DR_REPO:?}"; OUT="${DR_OUT:?}"; B="${DR_B:?}"
CAND=sha256:0b48162701518d1fb47789282112f2d5528429e77d6f108d3f8696570f06bc95
cd "$REPO"; ts() { date -u +%T; }
echo "start $(ts); HEAD $(git rev-parse HEAD); node $(node -v); free $(df -Pm "$TMPDIR" | awk 'NR==2{print $4}') MB"
U=$(node -e 'const u=new URL(process.env.TEST_DATABASE_ADMIN_URL);u.pathname="/mth_dr6_src";u.username="mth_owner";console.log(u.href)')
psql -X -q -d "$TEST_DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner LOGIN; END IF;
IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app LOGIN; END IF; END \$\$;
CREATE DATABASE mth_dr6_src OWNER mth_owner ENCODING 'UTF8' TEMPLATE template0;
GRANT CONNECT ON DATABASE mth_dr6_src TO mth_app;
SQL
(cd packages/db && DATABASE_OWNER_URL="$U" NODE_ENV=development node --conditions=@mth/source src/cli.ts migrate >/dev/null && \
  DATABASE_OWNER_URL="$U" NODE_ENV=development node --conditions=@mth/source src/cli.ts seed-demo | grep "reporting periods relative to") || { echo "demo db FAIL"; exit 1; }
DATABASE_OWNER_URL="$U" NODE_ENV=development node tools/migration/export.mjs --out "$B/export" --operator "transfer-drill synthetic operator" | tail -1
node tools/release/build-archive.mjs --repo "$REPO" --commit "$(git rev-parse HEAD)" --demo-data "$B/export" --candidate $CAND --out "$B/arch" | tail -2
echo "build-archive exit ${PIPESTATUS[0]}"
A=$(ls "$B"/arch/*.tar.gz | head -1); S=$(sha256sum "$A" | cut -c1-64); echo "archive $(basename "$A") $(stat -c %s "$A") bytes sha256 $S"
psql -X -q -d "$TEST_DATABASE_ADMIN_URL" -c "DROP DATABASE mth_dr6_src WITH (FORCE);"; rm -rf "$B/export"
[ -d "$B/store/v10" ] || { mkdir -p "$B/store" && cp -a /root/.local/share/pnpm/store/v10 "$B/store/v10"; }
echo "ready $(ts) free $(df -Pm "$TMPDIR" | awk 'NR==2{print $4}') MB"
drill() { # drill <label> <start HH:MM:SS> [--keep]
  local label="$1" start="$2" keep="${3:-}" now tgt rc o="$OUT/out-$1"
  now=$(date -u +%s); tgt=$(date -u -d "$start" +%s)
  [ "$tgt" -gt "$now" ] && { echo "[$label] waiting $((tgt-now)) s until $start"; sleep $((tgt-now)); }
  [ "$tgt" -lt "$now" ] && echo "[$label] WARNING: start $start already passed by $((now-tgt)) s; timing differs"
  mkdir -p "$o"; echo "[$label] transfer-drill.sh start $(ts)"; local t0; t0=$(date +%s)
  bash deploy/scripts/transfer-drill.sh --archive "$A" --sha256 "$S" --store "$B/store" --out "$o" --work "$B/work-$label" $keep > "$o/stdout.txt" 2> "$o/stderr.txt"
  rc=$?
  echo "[$label] drill exit $rc end $(ts) wall $(( $(date +%s)-t0 )) s; stderr lines $(wc -l < "$o/stderr.txt")"
  grep -E '^transfer-drill: (step D[0-9]+ (PASS|FAIL)|PASS|FAIL)' "$o/stdout.txt" | cut -c1-260
  grep -hE 'transfer-drill: D[79]: |is not schedule-explained|schedule rule not applicable|step D9 failed' "$o/step-D7.log" "$o/step-D9.log" | cut -c1-400
  grep -n "automation_\|unexplained" "$o/step-D9.log" | cut -c1-200
  node -e 'const r=require(process.argv[1]);const d=r.steps.find(s=>s.id==="D9");console.log("report result",r.result,"D9",d.result,"recheck",d.recheck,"window",JSON.stringify(d.scheduleWindow),"listed",JSON.stringify((d.scheduleExplained||[]).map(x=>[x.executionId,x.triggerKey,x.slot,x.status,x.createdAt,x.actionResultIds.length,x.auditEvents.length])))' "$o/transfer-drill-report.json"
  grep -n "approval.escalation_scan\|mth-worker started\|shutting down" "$o/worker.log" 2>/dev/null | cut -c1-220 | tail -8
  sha256sum "$o/transfer-drill-report.json" "$o/schedule-explained-d9.json" "$o/reconcile-d9.json" 2>&1
  pgrep -f "$B/work-$label/pg" >/dev/null && echo "[$label] PostgreSQL left running: YES" || echo "[$label] PostgreSQL left running: none"
  [ -n "$keep" ] || { rm -rf "$B/work-$label"; echo "[$label] removed work tree"; }
  return $rc
}
drill quarter "${QUARTER_START:?}" --keep; r1=$?
drill away "${AWAY_START:?}"; r2=$?
echo "quarter exit $r1; away exit $r2; archive kept at $A for probes"
echo "$A $S" > "$B/archive.txt"
