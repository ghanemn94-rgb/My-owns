#!/usr/bin/env bash
# code-security-reviewer DG5 r2 (T-DG5-RG-SEC-R2): F-DG5-100 on the real CLI (mth-db migrate / status) against a scratch
# database of a disposable PostgreSQL (run under tests/qa/support/with-pg.sh, from the review clone root $TMPDIR/rv).
# A later build is simulated by adding 0066_p6_example.sql (a retired P5 gap) and 0098_p6_forward.sql to the clone's
# shipped migrations directory; both are removed by the trap. The CLI output is operator text (English only); the
# refusal is run with LANG unset and with LANG=ar_SA.UTF-8 to show it does not depend on the locale.
set -u
cd "$TMPDIR/rv"
M=packages/db/migrations
trap 'rm -f $M/0066_p6_example.sql $M/0098_p6_forward.sql' EXIT
A="$TEST_DATABASE_ADMIN_URL"
psql -X -q "$A" -c "DO \$\$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app NOLOGIN; END IF; END\$\$" \
  -c "DROP DATABASE IF EXISTS sec_r2_cli" -c "CREATE DATABASE sec_r2_cli OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0"
OWNER=$(node -e 'const u=new URL(process.argv[1]);u.pathname="/sec_r2_cli";u.searchParams.set("options","-c role=mth_owner");console.log(u.toString())' "$A")
cli() { NODE_ENV=test DATABASE_OWNER_URL="$OWNER" node --conditions=@mth/source packages/db/src/cli.ts "$@"; }
q() { psql -X -tA "${A%/*}/sec_r2_cli" -c "$1"; }
echo "## 1. fresh scratch database: mth-db migrate (the shipped build)"; cli migrate | tail -2; echo "exit=${PIPESTATUS[0]}"
echo "## 2. mth-db status (shipped build)"; cli status | tail -1; echo "exit=${PIPESTATUS[0]}"
printf 'CREATE TABLE sec_r2_gap (id int);\n' > $M/0066_p6_example.sql
printf 'CREATE TABLE sec_r2_fwd (id int);\n' > $M/0098_p6_forward.sql
echo "## 3. later build adds 0066_p6_example.sql (retired gap) + 0098_p6_forward.sql: mth-db migrate, LANG unset"
(unset LANG LC_ALL; cli migrate); echo "exit=$?"
echo "## 4. same, LANG=ar_SA.UTF-8 LC_ALL=ar_SA.UTF-8"
(LANG=ar_SA.UTF-8 LC_ALL=ar_SA.UTF-8 cli migrate); echo "exit=$?"
echo "## 5. mth-db status (expect ORDER line, DRIFT, exit 4)"; cli status | grep -v '^APPLIED\|^ok' | tail -5; echo "exit=${PIPESTATUS[0]}"
echo "## 6. nothing applied: tables sec_r2_*, schema_migration rows, files shipped"
echo "tables=$(q "SELECT count(*) FROM pg_class WHERE relname LIKE 'sec_r2_%'") applied=$(q 'SELECT count(*) FROM schema_migration') shipped=$(ls $M | grep -c '^[0-9]\{4\}_.*\.sql$')"
rm -f $M/0066_p6_example.sql
echo "## 7. control: the gap file removed, only 0098_p6_forward.sql pending: mth-db migrate applies it"; cli migrate | tail -2; echo "exit=${PIPESTATUS[0]}"
echo "tables=$(q "SELECT string_agg(relname, ',') FROM pg_class WHERE relname LIKE 'sec_r2_%'")"
psql -X -q "$A" -c "DROP DATABASE sec_r2_cli"; echo "## scratch database dropped; exit=$?"
