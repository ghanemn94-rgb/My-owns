#!/usr/bin/env bash
# T-B11 driver (T-DG7-DO-D5; copied from DO-D4): demo export -> archive from HEAD -> transfer-drill.sh. SYNTHETIC data only.
set -u
REPO=/home/user/My-owns; B="$TMPDIR/b11"; E="$REPO/docs/delivery/handbacks/DG7/T-DG7-DO-D5-evidence"
cd "$REPO"
ts() { date -u +%T; }
echo "start $(ts); HEAD $(git rev-parse HEAD); free $(df -Pm "$TMPDIR" | awk 'NR==2{print $4}') MB"
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
  DATABASE_OWNER_URL="$OU" NODE_ENV=development node --conditions=@mth/source src/cli.ts seed-demo >/dev/null) || { echo "demo db FAIL"; exit 1; }
rm -rf "$B/export"; DATABASE_OWNER_URL="$OU" NODE_ENV=development node tools/migration/export.mjs --out "$B/export" --operator "transfer-drill synthetic operator" | tail -3
echo "demo export exit ${PIPESTATUS[0]} in $(( $(date +%s) - t0 )) s; manifest sha256 $(sha256sum "$B/export/manifest.json" | cut -c1-64)"
node -e 'const m=require(process.argv[1]); console.log("tables", m.tables.length, "rows", m.tables.reduce((a,t)=>a+(t.rows??t.rowCount??0),0))' "$B/export/manifest.json"
t0=$(date +%s)
node tools/release/build-archive.mjs --repo "$REPO" --commit "$(git rev-parse HEAD)" --demo-data "$B/export" --out "$B/arch" | tail -5
echo "build-archive exit ${PIPESTATUS[0]} in $(( $(date +%s) - t0 )) s"
A=$(ls "$B"/arch/*.tar.gz | head -1); S=$(sha256sum "$A" | cut -c1-64); echo "archive $(basename "$A") $(stat -c %s "$A") bytes sha256 $S"
t0=$(date +%s); mkdir -p "$B/store" && cp -a /root/.local/share/pnpm/store/v10 "$B/store/v10"; echo "store copy $(( $(date +%s) - t0 )) s"
psql -X -q -d "$TEST_DATABASE_ADMIN_URL" -c "DROP DATABASE mth_b11_src WITH (FORCE);"
rm -rf "$E/transfer"; t0=$(date +%s)
bash deploy/scripts/transfer-drill.sh --archive "$A" --sha256 "$S" --store "$B/store" --out "$E/transfer"
rc=$?
echo "transfer-drill exit $rc in $(( $(date +%s) - t0 )) s; end $(ts)"
rm -rf "$B/store" "$B/export"
exit $rc
