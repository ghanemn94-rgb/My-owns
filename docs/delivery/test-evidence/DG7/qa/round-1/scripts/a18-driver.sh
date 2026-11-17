#!/usr/bin/env bash
# qa-verifier DG7 round 1 (T-DG7-REV-QA-RG1): A18 on the frozen candidate, ONE archive for both halves.
# 1) demo installation (migrate + seed-demo, SYNTHETIC) on a disposable cluster, migration export;
# 2) build-archive.mjs at the source commit ddf42ccd2 WITH --candidate (the archive must carry candidate 9822d8fe);
# 3) build-archive.mjs --verify of that archive against its recorded sha256;
# 4) deploy/scripts/transfer-drill.sh (T-B11, D0-D11) on it;
# 5) the A18 harness tests/qa/integration/a18-transfer-drill.test.ts on the SAME archive (it runs the drill again itself).
# Derived from docs/delivery/test-evidence/DG7/qa/T-DG7-QA-C/t-b11-a18-driver.sh; repository = the disposable clone,
# evidence = this round's qa directory. Run under tests/qa/support/with-pg.sh. Nothing here approves anything.
set -u
REPO="$TMPDIR/rv"; B="$TMPDIR/qa-a18"; E=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-1/a18
CAND=sha256:9822d8fe947b572d30a24e1f59798587edd610a0c8b8f81a21eaceeb3233a744
COMMIT=ddf42ccd2630f3d62f6aaf360ff401bbc2bde025
for d in "$B" "$E/transfer" "$E/harness"; do [ -e "$d" ] && { echo "BLOCKED: $d exists"; exit 2; }; done
mkdir -p "$E/transfer" "$E/harness" "$B"
cd "$REPO" || exit 2
ts() { date -u +%T; }
echo "start $(ts); clone HEAD $(git rev-parse HEAD); node $(node -v); free $(df -Pm "$TMPDIR" | awk 'NR==2{print $4}') MB"
U=$(node -e 'const u=new URL(process.env.TEST_DATABASE_ADMIN_URL);u.pathname="/mth_qa_src";u.username="mth_owner";console.log(u.href)')
psql -X -q -d "$TEST_DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner LOGIN; END IF;
IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app LOGIN; END IF; END \$\$;
CREATE DATABASE mth_qa_src OWNER mth_owner ENCODING 'UTF8' TEMPLATE template0;
GRANT CONNECT ON DATABASE mth_qa_src TO mth_app;
SQL
t0=$(date +%s)
(cd packages/db && DATABASE_OWNER_URL="$U" NODE_ENV=development node --conditions=@mth/source src/cli.ts migrate >/dev/null && \
  DATABASE_OWNER_URL="$U" NODE_ENV=development node --conditions=@mth/source src/cli.ts seed-demo | grep "reporting periods relative to") || { echo "demo db FAIL"; exit 1; }
DATABASE_OWNER_URL="$U" NODE_ENV=development node tools/migration/export.mjs --out "$B/export" --operator "qa round-1 synthetic operator" | tail -3
echo "demo export exit ${PIPESTATUS[0]} in $(( $(date +%s) - t0 )) s; manifest sha256 $(sha256sum "$B/export/manifest.json" | cut -c1-64)"
t0=$(date +%s)
node tools/release/build-archive.mjs --repo "$REPO" --commit "$COMMIT" --candidate "$CAND" --demo-data "$B/export" --out "$B/arch" | tail -6
echo "build-archive exit ${PIPESTATUS[0]} in $(( $(date +%s) - t0 )) s"
A=$(ls "$B"/arch/*.tar.gz | head -1); S=$(sha256sum "$A" | cut -c1-64); echo "archive $(basename "$A") $(stat -c %s "$A") bytes sha256 $S"
echo "$S  $(basename "$A")" > "$E/archive.sha256"
node tools/release/build-archive.mjs --verify "$A" --expect-sha256 "$S" --candidate "$CAND" | tail -8
echo "verify exit ${PIPESTATUS[0]}"
tar -tzf "$A" | awk -F/ '{print $2}' | sort | uniq -c > "$E/archive-top-level.txt"; cat "$E/archive-top-level.txt"
psql -X -q -d "$TEST_DATABASE_ADMIN_URL" -c "DROP DATABASE mth_qa_src WITH (FORCE);"
t0=$(date +%s)
bash deploy/scripts/transfer-drill.sh --archive "$A" --sha256 "$S" --store "$TMPDIR/store" --out "$E/transfer"
rc=$?
echo "T-B11 transfer-drill exit $rc in $(( $(date +%s) - t0 )) s; end $(ts)"
t0=$(date +%s)
QA_A18_ARCHIVE="$A" QA_A18_ARCHIVE_SHA256="$S" QA_A18_STORE="$TMPDIR/store" QA_A18_OUT="$E/harness" \
  npx vitest run --project integration tests/qa/integration/a18-transfer-drill.test.ts
rc2=$?
echo "A18 harness exit $rc2 in $(( $(date +%s) - t0 )) s; end $(ts)"
rm -rf "$B"; echo "removed $B"
echo "RESULT transfer-drill=$rc harness=$rc2"
[ "$rc" = 0 ] && [ "$rc2" = 0 ]
