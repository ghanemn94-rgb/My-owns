#!/bin/bash
# qa-verifier DG2 round 17: integration series on clone $TMPDIR/review-dg2 @805da3e2 (source commit; candidate ddaab3cc
# recomputed identical), 3 runs per locale setting ('unset' = env -u LANG -u LC_ALL; 'cutf8' = env -u LC_ALL
# LANG=C.UTF-8), each on its own disposable PostgreSQL (unique port, tests/qa/support/with-pg.sh). The qa-verifier
# evidence suites (dg2-qa-acceptance, round-2 design/journey, round-3 blank-sweep/regress) are copied into
# tests/qa/integration of the CLONE only (never the candidate tree). Then the migrations check (12-migrations.log).
cd $TMPDIR/review-dg2
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
Q=/home/user/My-owns/docs/delivery/test-evidence/DG2/qa/tests
cp $Q/dg2-qa-acceptance.test.ts $Q/round-2/dg2-qa-design-r2.test.ts $Q/round-2/dg2-qa-journey-r2.test.ts \
   $Q/round-3/dg2-qa-blank-sweep-r3.test.ts $Q/round-3/dg2-qa-regress-r3.test.ts tests/qa/integration/
R=/home/user/My-owns/docs/delivery/test-evidence/DG2/qa/round-17
E=$R/integration
port=25741
for n in 1 2 3; do
 for loc in unset cutf8; do
  if [ $loc = unset ]; then L="env -u LANG -u LC_ALL"; else L="env -u LC_ALL LANG=C.UTF-8"; fi
  f=$E/integration-$loc-run$n.log
  { echo "\$ $L QA_PG_PORT=$port tests/qa/support/with-pg.sh npx vitest run --project integration --reporter=verbose"; echo "# clone @805da3e2 + 5 qa-verifier suites in tests/qa/integration (clone only); node $(node -v); $(date -u +%FT%TZ)";
    $L QA_PG_PORT=$port tests/qa/support/with-pg.sh npx vitest run --project integration --reporter=verbose 2>&1; echo "exit $?"; } | sed "s#$TMPDIR#\$TMPDIR#g" > $f
  echo "$f: $(grep -E '^\s+Tests ' $f | tail -n 1) $(tail -n 1 $f)"
  port=$((port+1))
 done
done
# migrations 0001 -> latest on a fresh database, then idempotent re-run
cat > $TMPDIR/mig.sh <<'EOS'
set -e
A="$TEST_DATABASE_ADMIN_URL"
psql "$A" -q -v ON_ERROR_STOP=1 -c "CREATE ROLE mth_owner NOLOGIN" -c "CREATE ROLE mth_app NOLOGIN" -c "CREATE DATABASE mth OWNER mth_owner ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0"
U=$(node -e 'const u=new URL(process.argv[1]);u.pathname="/mth";u.searchParams.set("options","-c role=mth_owner");console.log(u.toString())' "$A")
export NODE_ENV=development DATABASE_OWNER_URL="$U"
psql "${A%/postgres}/mth" -qAtc "select 'server_encoding ' || pg_encoding_to_char(encoding) || ', lc_collate ' || datcollate || ', lc_ctype ' || datctype from pg_database where datname = 'mth'"
echo "--- migrate (fresh database)"; node packages/db/dist/cli.js migrate; echo "migrate exit $?"
echo "--- applied migrations (schema_migration)"; psql "${A%/postgres}/mth" -qAtc "select id || ' ' || name from schema_migration order by id"
echo "--- migrate again (idempotent: nothing to apply)"; node packages/db/dist/cli.js migrate; echo "migrate exit $?"
echo "--- count"; psql "${A%/postgres}/mth" -qAtc "select count(*), min(id), max(id) from schema_migration"
EOS
{ echo "\$ env -u LC_ALL LANG=C.UTF-8 QA_PG_PORT=25751 tests/qa/support/with-pg.sh bash \$TMPDIR/mig.sh   # script:"; sed 's/^/#   /' $TMPDIR/mig.sh; echo "# cwd clone @805da3e2; node $(node -v); $(date -u +%FT%TZ)";
  env -u LC_ALL LANG=C.UTF-8 QA_PG_PORT=25751 tests/qa/support/with-pg.sh bash $TMPDIR/mig.sh 2>&1; echo "exit $?"; } | sed "s#$TMPDIR#\$TMPDIR#g" > $R/12-migrations.log
echo "12-migrations.log: $(tail -n 1 $R/12-migrations.log)"
echo integration-done
