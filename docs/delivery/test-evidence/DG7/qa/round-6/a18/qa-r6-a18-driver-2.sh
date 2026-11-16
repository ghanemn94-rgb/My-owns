#!/usr/bin/env bash
# qa-verifier DG7 round 6 (T-DG7-REV-QA-R6): A18 on a fresh archive built from the FROZEN candidate clone (830d7edf,
# candidate 0b481627). F-DG7-971 adversarial verification:
#   part 1: transfer-drill.sh --keep, started at $QA_START1 so that its D7-D9 window should contain a quarter hour;
#           then the kept-target probes (kept-target-probes.sh: mutate the disposable target, re-run the shipped
#           schedule-explained.mjs CLI, expect FAIL for every forbidden case), then the work tree is removed;
#   part 2: the shipped A18 harness (QA_A18_REQUIRE=1) on the same archive, started at $QA_START2 (aimed at the next
#           quarter hour);
#   part 3: transfer-drill.sh again, started right after part 2 (expected away from a quarter hour).
# No job is paused or rescheduled; nothing in the candidate is changed. SYNTHETIC data only; nothing here approves
# anything (no G1-G6, Finance, IT or DG approval). Run under tests/qa/support/with-pg.sh.
# Attempt 2 (round-6 correction): QA_B names a scratch directory of its own, QA_OUT a sub-directory of its own and
# QA_PROBE_PORT the probe port, because an orphaned attempt-1/attempt-1b driver process (not visible to later sandboxed
# shells, so not killable from them) still shares $TMPDIR/qa-r6-a18, a18/p1-quarter, p2-harness, p3-away and port 32595.
set -u
REPO="${QA_REPO:?}"; OUT="${QA_OUT:?}"; B="${QA_B:-$TMPDIR/qa-r6-a18}"; CAND=sha256:0b48162701518d1fb47789282112f2d5528429e77d6f108d3f8696570f06bc95
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
DATABASE_OWNER_URL="$U" NODE_ENV=development node tools/migration/export.mjs --out "$B/export" --operator "transfer-drill synthetic operator" | tail -3
echo "demo export exit ${PIPESTATUS[0]}; manifest sha256 $(sha256sum "$B/export/manifest.json" | cut -c1-64)"
node tools/release/build-archive.mjs --repo "$REPO" --commit "$(git rev-parse HEAD)" --demo-data "$B/export" --candidate $CAND --out "$B/arch" | tail -3
echo "build-archive exit ${PIPESTATUS[0]}"
A=$(ls "$B"/arch/*.tar.gz | head -1); S=$(sha256sum "$A" | cut -c1-64); echo "archive $(basename "$A") $(stat -c %s "$A") bytes sha256 $S"
node tools/release/build-archive.mjs --verify "$A" --expect-sha256 "$S" --candidate $CAND; echo "archive --verify exit $?"
psql -X -q -d "$TEST_DATABASE_ADMIN_URL" -c "DROP DATABASE mth_a18_src WITH (FORCE);"; rm -rf "$B/export"
mkdir -p "$B/store" && cp -a "${QA_STORE_SRC:?}" "$B/store/v10"

summary() { # $1 out dir
  grep -E '^transfer-drill: (step D[0-9]+ (PASS|FAIL)|PASS|FAIL)' "$1/stdout.txt" | cut -c1-200
  grep -hE 'transfer-drill: D[79]: |is not schedule-explained|schedule rule not applicable|step D9 failed' "$1/step-D7.log" "$1/step-D9.log" 2>/dev/null | cut -c1-400
  node -e 'const r=require(process.argv[1]);const d=r.steps.find(s=>s.id==="D9");console.log("report result",r.result,"| D9",d.result,"recheck",d.recheck,"window",JSON.stringify(d.scheduleWindow),"| listed",JSON.stringify((d.scheduleExplained||[]).map(x=>[x.executionId,x.triggerKey,x.slot,x.status,x.createdAt,x.actionResultIds.length,x.auditEvents.length])))' "$1/transfer-drill-report.json" 2>&1
}

mkdir -p "$OUT/p1-quarter"; W="$B/work"
waituntil "${QA_START1:?}"
echo "--- part 1: transfer-drill.sh --keep start $(ts) free $(free) MB"
bash deploy/scripts/transfer-drill.sh --archive "$A" --sha256 "$S" --store "$B/store" --out "$OUT/p1-quarter" --work "$W" --keep > "$OUT/p1-quarter/stdout.txt" 2> "$OUT/p1-quarter/stderr.txt"
rc1=$?; echo "part 1 drill exit $rc1 $(ts)"; summary "$OUT/p1-quarter"
echo "stderr lines: $(wc -l < "$OUT/p1-quarter/stderr.txt")"; head -5 "$OUT/p1-quarter/stderr.txt"
cp "$W/reconcile-d9.txt" "$OUT/p1-quarter/reconcile-d9.txt" 2>/dev/null
echo "--- kept-target probes start $(ts)"
QA_W="$W" QA_P1="$OUT/p1-quarter" QA_PROBE_OUT="$OUT/probes" bash "$HERE/kept-target-probes.sh"
echo "kept-target probes exit $? $(ts)"
pgrep -f "$W/pg" >/dev/null && echo "drill PostgreSQL left running: YES" || echo "drill PostgreSQL left running: none"
rm -rf "$W"; echo "removed work tree $(ts) free $(free) MB"

mkdir -p "$OUT/p2-harness"
waituntil "${QA_START2:?}"
echo "--- part 2: A18 harness start $(ts) free $(free) MB"
QA_A18_REQUIRE=1 QA_A18_ARCHIVE="$A" QA_A18_ARCHIVE_SHA256="$S" QA_A18_STORE="$B/store" QA_A18_OUT="$OUT/p2-harness" \
  npx vitest run --project integration tests/qa/integration/a18-transfer-drill.test.ts --reporter=verbose
rc2=$?; echo "A18 harness exit $rc2 end $(ts)"
[ -f "$OUT/p2-harness/transfer-drill-report.json" ] && summary "$OUT/p2-harness"

mkdir -p "$OUT/p3-away"
echo "--- part 3: transfer-drill.sh start $(ts) free $(free) MB"
bash deploy/scripts/transfer-drill.sh --archive "$A" --sha256 "$S" --store "$B/store" --out "$OUT/p3-away" --work "$B/work3" > "$OUT/p3-away/stdout.txt" 2> "$OUT/p3-away/stderr.txt"
rc3=$?; echo "part 3 drill exit $rc3 $(ts)"; summary "$OUT/p3-away"
echo "stderr lines: $(wc -l < "$OUT/p3-away/stderr.txt")"; head -5 "$OUT/p3-away/stderr.txt"
pgrep -f "$B/work" >/dev/null && echo "drill PostgreSQL left running: YES" || echo "drill PostgreSQL left running: none"
rm -rf "$B"; echo "removed $B $(ts)"
echo "part 1 drill exit $rc1; part 2 harness exit $rc2; part 3 drill exit $rc3"
[ "$rc1" -eq 0 ] && [ "$rc2" -eq 0 ] && [ "$rc3" -eq 0 ] || exit 1
exit 0
