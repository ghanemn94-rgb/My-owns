#!/usr/bin/env bash
# qa-verifier DG7 round 7 (T-DG7-REV-QA-R7): A18 on a fresh archive built from the FROZEN candidate clone (7579382c,
# candidate 0d71d445). Run under tests/qa/support/with-pg.sh (QA_PG_PORT in 32500-32599).
#   part 1: transfer-drill.sh (no --keep) on the archive;
#   part 2: the shipped A18 harness (QA_A18_REQUIRE=1) on the same archive and store.
# No job is paused or rescheduled; nothing in the candidate is changed. SYNTHETIC data only; nothing here approves
# anything (no G1-G6, Finance, IT or DG approval).
set -u
REPO="${QA_REPO:?}"; OUT="${QA_OUT:?}"; B="$TMPDIR/qa-r7-a18"; CAND=sha256:0d71d4456adaac949e2c9af4c975f4b9976a166872195f496d5aa75fe8ed2272
[ -e "$B" ] && { echo "BLOCKED: $B exists"; exit 2; }
cd "$REPO"; ts() { date -u +%T; }
free() { df -Pm "$TMPDIR" | awk 'NR==2{print $4}'; }
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
  grep -E '^transfer-drill: (step D[0-9]+ (PASS|FAIL)|PASS|FAIL)' "$1/stdout.txt" 2>/dev/null | cut -c1-200
  grep -hE 'transfer-drill: D[79]: |is not schedule-explained|schedule rule not applicable|step D9 failed' "$1/step-D7.log" "$1/step-D9.log" 2>/dev/null | cut -c1-400
  node -e 'const r=require(process.argv[1]);const d=r.steps.find(s=>s.id==="D9");console.log("report result",r.result,"| steps",r.steps.map(s=>s.id+":"+s.result).join(" "),"| D9 recheck",d.recheck,"window",JSON.stringify(d.scheduleWindow),"| listed",JSON.stringify((d.scheduleExplained||[]).map(x=>[x.executionId,x.triggerKey,x.slot,x.status,x.createdAt,x.actionResultIds.length,x.auditEvents.length])))' "$1/transfer-drill-report.json" 2>&1
}

mkdir -p "$OUT/p1-drill"
echo "--- part 1: transfer-drill.sh start $(ts) free $(free) MB"
bash deploy/scripts/transfer-drill.sh --archive "$A" --sha256 "$S" --store "$B/store" --out "$OUT/p1-drill" --work "$B/work1" > "$OUT/p1-drill/stdout.txt" 2> "$OUT/p1-drill/stderr.txt"
rc1=$?; echo "part 1 drill exit $rc1 $(ts)"; summary "$OUT/p1-drill"
echo "stderr lines: $(wc -l < "$OUT/p1-drill/stderr.txt")"; head -5 "$OUT/p1-drill/stderr.txt"

mkdir -p "$OUT/p2-harness"
echo "--- part 2: A18 harness start $(ts) free $(free) MB"
QA_A18_REQUIRE=1 QA_A18_ARCHIVE="$A" QA_A18_ARCHIVE_SHA256="$S" QA_A18_STORE="$B/store" QA_A18_OUT="$OUT/p2-harness" \
  npx vitest run --configLoader runner --project integration tests/qa/integration/a18-transfer-drill.test.ts --reporter=verbose
rc2=$?; echo "A18 harness exit $rc2 end $(ts)"
[ -f "$OUT/p2-harness/transfer-drill-report.json" ] && summary "$OUT/p2-harness"
pgrep -f "$B/work" >/dev/null && echo "drill PostgreSQL left running: YES" || echo "drill PostgreSQL left running: none"
rm -rf "$B"; echo "removed $B $(ts)"
echo "part 1 drill exit $rc1; part 2 harness exit $rc2"
[ "$rc1" -eq 0 ] && [ "$rc2" -eq 0 ] || exit 1
exit 0
