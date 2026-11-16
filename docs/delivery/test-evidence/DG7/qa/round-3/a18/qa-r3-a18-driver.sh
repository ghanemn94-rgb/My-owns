#!/usr/bin/env bash
# qa-verifier DG7 round 3 (T-DG7-REV-QA-R3): the A18 harness on a fresh archive built from the FROZEN candidate clone.
# Adapted from QA-C's t-b11-a18-driver.sh: REPO is the disposable clone at 8323dac (not the live repository), the
# harness runs the transfer drill itself (QA_A18_REQUIRE=1: missing inputs FAIL, never skip). Run under
# tests/qa/support/with-pg.sh. SYNTHETIC data only; nothing here approves anything (no G1-G6, Finance, IT or DG gate).
set -u
REPO="${QA_REPO:?}"; OUT="${QA_OUT:?}"; B="$TMPDIR/qa-r3-a18"
[ -e "$B" ] && { echo "BLOCKED: $B exists"; exit 2; }
cd "$REPO"
ts() { date -u +%T; }
echo "start $(ts); HEAD $(git rev-parse HEAD); node $(node -v); free $(df -Pm "$TMPDIR" | awk 'NR==2{print $4}') MB"
U=$(node -e 'const u=new URL(process.env.TEST_DATABASE_ADMIN_URL);u.pathname="/mth_a18_src";u.username="mth_owner";console.log(u.href)')
psql -X -q -d "$TEST_DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner LOGIN; END IF;
IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app LOGIN; END IF; END \$\$;
CREATE DATABASE mth_a18_src OWNER mth_owner ENCODING 'UTF8' TEMPLATE template0;
GRANT CONNECT ON DATABASE mth_a18_src TO mth_app;
SQL
t0=$(date +%s)
(cd packages/db && DATABASE_OWNER_URL="$U" NODE_ENV=development node --conditions=@mth/source src/cli.ts migrate >/dev/null && \
  DATABASE_OWNER_URL="$U" NODE_ENV=development node --conditions=@mth/source src/cli.ts seed-demo | grep "reporting periods relative to") || { echo "demo db FAIL"; exit 1; }
DATABASE_OWNER_URL="$U" NODE_ENV=development node tools/migration/export.mjs --out "$B/export" --operator "transfer-drill synthetic operator" | tail -3
echo "demo export exit ${PIPESTATUS[0]} in $(( $(date +%s) - t0 )) s; manifest sha256 $(sha256sum "$B/export/manifest.json" | cut -c1-64)"
node -e 'const m=require(process.argv[1]); console.log("tables", m.tables.length, "rows", m.tables.reduce((a,t)=>a+Number(t.rows??t.rowCount??0),0))' "$B/export/manifest.json"
t0=$(date +%s)
node tools/release/build-archive.mjs --repo "$REPO" --commit "$(git rev-parse HEAD)" --demo-data "$B/export" --candidate sha256:60dd90b6c5a7af3b502f02be68e6b601fd11e90fcbc0a48166cbc389453a80e9 --out "$B/arch" | tail -5
echo "build-archive exit ${PIPESTATUS[0]} in $(( $(date +%s) - t0 )) s"
A=$(ls "$B"/arch/*.tar.gz | head -1); S=$(sha256sum "$A" | cut -c1-64); echo "archive $(basename "$A") $(stat -c %s "$A") bytes sha256 $S"
echo "archive top-level layout:"; tar -tzf "$A" | awk -F/ 'NF>1{print $1"/"$2}' | sort -u | head -40
node tools/release/build-archive.mjs --verify "$A" --expect-sha256 "$S" --candidate sha256:60dd90b6c5a7af3b502f02be68e6b601fd11e90fcbc0a48166cbc389453a80e9; echo "archive --verify exit $?"
mkdir -p "$B/store" && cp -a "${QA_STORE_SRC:?}/v10" "$B/store/v10"
psql -X -q -d "$TEST_DATABASE_ADMIN_URL" -c "DROP DATABASE mth_a18_src WITH (FORCE);"
mkdir -p "$OUT"; t0=$(date +%s)
QA_A18_REQUIRE=1 QA_A18_ARCHIVE="$A" QA_A18_ARCHIVE_SHA256="$S" QA_A18_STORE="$B/store" QA_A18_OUT="$OUT" \
  npx vitest run --project integration tests/qa/integration/a18-transfer-drill.test.ts
rc2=$?
echo "A18 harness exit $rc2 in $(( $(date +%s) - t0 )) s; end $(ts)"
# Round 3 addition (F-DG7-963, adversarial; the DO-D8 handback's known gap "PASS plus a forced cleanup failure is not
# covered end to end"): the same archive through transfer-drill.sh directly, with an `rm` on PATH that refuses ONLY the
# exact top-level work directory (td_remove_work's `rm -rf -- <work>`), never a path inside it. Expected: the PASS line,
# exit 0 (unchanged), one WARNING line on stderr and in drill.log, and the work tree left for removal by hand.
FB="$TMPDIR/qa-r3-fake-rm"; mkdir -p "$FB"; W="$TMPDIR/qa-r3-a18-w2"; O2="$OUT/forced-cleanup-failure"; mkdir -p "$O2"
REALRM="$(command -v rm)"
printf '#!/bin/bash\nfor a in "$@"; do [ "${a%%/}" = "%s" ] && { echo "rm: cannot remove %s: QA forced failure" >&2; exit 1; }; done\nexec %s "$@"\n' "$W" "'$W'" "$REALRM" > "$FB/rm"; chmod 755 "$FB/rm"
echo "--- forced-cleanup-failure drill start $(ts)"
PATH="$FB:$PATH" bash deploy/scripts/transfer-drill.sh --archive "$A" --sha256 "$S" --store "$B/store" --out "$O2" --work "$W" > "$O2/stdout.txt" 2> "$O2/stderr.txt"
rc3=$?
echo "forced-cleanup-failure drill exit $rc3 end $(ts)"
grep -E '^transfer-drill: (PASS|FAIL)' "$O2/stdout.txt" | head -3
echo "stderr WARNING lines: $(grep -c 'transfer-drill: WARNING: could not remove the work directory' "$O2/stderr.txt")"; grep 'WARNING' "$O2/stderr.txt" | head -3
echo "drill.log WARNING lines: $(grep -c 'transfer-drill: WARNING: could not remove the work directory' "$O2/drill.log")"
[ -d "$W" ] && echo "work tree left in place (expected)" || echo "work tree absent"
"$REALRM" -rf "$W" "$FB"
rm -rf "$B"; echo "removed $B"
echo "A18 harness exit $rc2; forced-cleanup drill exit $rc3"
[ "$rc2" -eq 0 ] && [ "$rc3" -eq 0 ] || exit 1
exit 0
