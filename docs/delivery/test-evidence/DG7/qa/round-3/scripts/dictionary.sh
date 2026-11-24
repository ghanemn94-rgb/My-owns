#!/usr/bin/env bash
# qa-verifier DG7 round 3: REQ-S19-005 "the data dictionary covers every table and column in the final schema" and
# "production initialization on a clean database succeeds", on the candidate clone. Run under with-pg.sh.
# A fresh database: mth-db migrate (production path, NODE_ENV=production), then mth-db bootstrap (first admin,
# SYNTHETIC), a second bootstrap must refuse; then dictionary-coverage.mjs (read-only catalogue queries).
set -u
cd "$TMPDIR/rv" || exit 2
OU=$(node -e 'const u=new URL(process.env.TEST_DATABASE_ADMIN_URL);u.pathname="/mth_qa_dict";u.username="mth_owner";console.log(u.href)')
AU=$(node -e 'const u=new URL(process.env.TEST_DATABASE_ADMIN_URL);u.pathname="/mth_qa_dict";console.log(u.href)')
psql -X -q -d "$TEST_DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner LOGIN; END IF;
IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app LOGIN; END IF; END \$\$;
CREATE DATABASE mth_qa_dict OWNER mth_owner ENCODING 'UTF8' TEMPLATE template0;
GRANT CONNECT ON DATABASE mth_qa_dict TO mth_app;
SQL
cd packages/db
echo "## migrate (NODE_ENV=production)"; DATABASE_OWNER_URL="$OU" NODE_ENV=production node --conditions=@mth/source src/cli.ts migrate | tail -3; echo "exit=${PIPESTATUS[0]}"
B="--org-code QA-DICT --org-name-en QA-org-synthetic --org-name-ar منظمة-اصطناعية --admin-name Synthetic-Admin --admin-email qa.admin@example.invalid --admin-issuer https://idp.example.invalid/realms/qa --admin-subject 5f0c7a52-1d1e-4c9a-9a51-6a0d0e5a0099"
echo "## bootstrap 1"; DATABASE_OWNER_URL="$OU" NODE_ENV=production node --conditions=@mth/source src/cli.ts bootstrap $B 2>&1 | tail -3; echo "exit=${PIPESTATUS[0]}"
echo "## bootstrap 2 (must refuse)"; DATABASE_OWNER_URL="$OU" NODE_ENV=production node --conditions=@mth/source src/cli.ts bootstrap $B 2>&1 | tail -3; echo "exit=${PIPESTATUS[0]}"
cd ../..
echo "## dictionary-coverage (no pgboss schema yet: the worker creates it)"; node tools/release/dictionary-coverage.mjs --database-url "$AU" 2>&1 | tail -15; echo "exit=${PIPESTATUS[0]}"
psql -X -q -d "$TEST_DATABASE_ADMIN_URL" -c "DROP DATABASE mth_qa_dict WITH (FORCE);"
