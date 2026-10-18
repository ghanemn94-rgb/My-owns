#!/usr/bin/env bash
# qa-verifier r2: does ORDER BY id of five rows created in one loop by mth_uuid_v7() (the 0018 diagnostic_item
# instantiation path) follow their creation (ordinal) order? Runs inside tests/qa/support/with-pg.sh (disposable cluster).
set -u
M=$TMPDIR/rev/packages/db/migrations/0010_p2_record_guards.sql
FN=$(awk '/^CREATE FUNCTION mth_uuid_v7\(\)/,/^END \$\$;/' $M)
psql "$TEST_DATABASE_ADMIN_URL" -qAt <<SQL
$FN
CREATE TABLE t (trial int, ordinal int, id uuid);
DO \$\$ BEGIN FOR tr IN 1..500 LOOP FOR o IN 1..5 LOOP INSERT INTO t VALUES (tr, o, mth_uuid_v7()); END LOOP; END LOOP; END \$\$;
WITH firsts AS (SELECT DISTINCT ON (trial) trial, ordinal FROM t ORDER BY trial, id)
SELECT 'trials=' || count(*) || ' first-by-id is NOT ordinal 1 in ' || count(*) FILTER (WHERE ordinal <> 1) || ' trials' FROM firsts;
SELECT 'trials whose 5 ids share one millisecond: ' || count(*) FROM (SELECT trial FROM t GROUP BY trial HAVING count(DISTINCT substring(id::text,1,13)) = 1) s;
SQL
