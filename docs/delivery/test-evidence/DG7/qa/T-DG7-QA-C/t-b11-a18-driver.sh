#!/usr/bin/env bash
# T-DG7-QA-C (qa-verifier): independent fresh T-B11 transfer drill, then the A18 harness on the same archive.
# Derived from DO-E's driver (docs/delivery/handbacks/DG7/T-DG7-DO-E-evidence/t-b11-driver.sh); only the evidence
# paths changed and the A18 harness step added. Run under tests/qa/support/with-pg.sh. SYNTHETIC data only; nothing
# here approves anything (no G1-G6, Finance or IT approval, no DG gate).
set -u
REPO=/home/user/My-owns; R="${QAC_RUN:?set QAC_RUN to a unique run tag}"
B="$TMPDIR/qac-b11-$R"; E="$REPO/docs/delivery/test-evidence/DG7/qa/T-DG7-QA-C"
# Runs 0 and 1 shared one scratch and one output directory and mixed their evidence (disclosed in the handback);
# every run now has its own, and an existing one is refused.
for d in "$B" "$E/transfer-$R" "$E/a18-out-$R"; do [ -e "$d" ] && { echo "BLOCKED: $d exists (run tag reused)"; exit 2; }; done
cd "$REPO"
ts() { date -u +%T; }
echo "start $(ts); HEAD $(git rev-parse HEAD); node $(node -v); free $(df -Pm "$TMPDIR" | awk 'NR==2{print $4}') MB"
U=$(node -e 'const u=new URL(process.env.TEST_DATABASE_ADMIN_URL);u.pathname="/mth_b11_src";console.log(u.href)')
OU=$(node -e 'const u=new URL(process.env.TEST_DATABASE_ADMIN_URL);u.pathname="/mth_b11_src";u.username="mth_owner";console.log(u.href)')
psql -X -q -d "$TEST_DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner LOGIN; END IF;
IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app LOGIN; END IF; END \$\$;
CREATE DATABASE mth_b11_src OWNER mth_owner ENCODING 'UTF8' TEMPLATE template0;
GRANT CONNECT ON DATABASE mth_b11_src TO mth_app;
SQL
t0=$(date +%s)
(cd packages/db && DATABASE_OWNER_URL="$OU" NODE_ENV=development node --conditions=@mth/source src/cli.ts migrate >/dev/null && \
  DATABASE_OWNER_URL="$OU" NODE_ENV=development node --conditions=@mth/source src/cli.ts seed-demo | grep "reporting periods relative to") || { echo "demo db FAIL"; exit 1; }
rm -rf "$B/export"; DATABASE_OWNER_URL="$OU" NODE_ENV=development node tools/migration/export.mjs --out "$B/export" --operator "transfer-drill synthetic operator" | tail -3
echo "demo export exit ${PIPESTATUS[0]} in $(( $(date +%s) - t0 )) s; manifest sha256 $(sha256sum "$B/export/manifest.json" | cut -c1-64)"
node -e 'const m=require(process.argv[1]); console.log("tables", m.tables.length, "rows", m.tables.reduce((a,t)=>a+Number(t.rows??t.rowCount??0),0))' "$B/export/manifest.json"
t0=$(date +%s)
node tools/release/build-archive.mjs --repo "$REPO" --commit "$(git rev-parse HEAD)" --demo-data "$B/export" --out "$B/arch" | tail -5
echo "build-archive exit ${PIPESTATUS[0]} in $(( $(date +%s) - t0 )) s"
A=$(ls "$B"/arch/*.tar.gz | head -1); S=$(sha256sum "$A" | cut -c1-64); echo "archive $(basename "$A") $(stat -c %s "$A") bytes sha256 $S"
t0=$(date +%s); mkdir -p "$B/store" && cp -a /root/.local/share/pnpm/store/v10 "$B/store/v10"; echo "store copy $(( $(date +%s) - t0 )) s"
psql -X -q -d "$TEST_DATABASE_ADMIN_URL" -c "DROP DATABASE mth_b11_src WITH (FORCE);"
t0=$(date +%s)
bash deploy/scripts/transfer-drill.sh --archive "$A" --sha256 "$S" --store "$B/store" --out "$E/transfer-$R"
rc=$?
echo "T-B11 transfer-drill exit $rc in $(( $(date +%s) - t0 )) s; end $(ts)"
mkdir -p "$E/a18-out-$R"; t0=$(date +%s)
QA_A18_ARCHIVE="$A" QA_A18_ARCHIVE_SHA256="$S" QA_A18_STORE="$B/store" QA_A18_OUT="$E/a18-out-$R" \
  npx vitest run --configLoader runner --project integration tests/qa/integration/a18-transfer-drill.test.ts
rc2=$?
echo "A18 harness exit $rc2 in $(( $(date +%s) - t0 )) s; end $(ts)"
rm -rf "$B"; echo "removed $B (disk)"
[ "$rc" = 0 ] && [ "$rc2" = 0 ]
