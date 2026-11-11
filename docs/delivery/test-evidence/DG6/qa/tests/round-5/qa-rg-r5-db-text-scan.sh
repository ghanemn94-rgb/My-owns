#!/bin/bash
# qa-verifier DG6 RG round 5 (T-DG6-REV-QA-RG-R5): an INDEPENDENT scan of the stored data of a running stack's database
# for text naming an engineering delivery gate (DG0-DG7) or citing an internal engineering record (decision id D-nnn,
# ADR-nnnn, task id T-DGx-, finding id F-DGx-). Not part of the candidate. Run inside a stack wrapper that exports
# DATABASE_OWNER_URL, e.g.  e2e/support/with-demo-stack.sh bash <this file>  or  apps/web/e2e/support/with-stack.sh bash <this file>.
# It uses the product's own SQL rule p5_mentions_engineering_gate (0089) and, independently, a wider regex of mine
# (no pre-filter). Every text, varchar, char, text[] and json(b) column of every public base table is read.
# Output: one line per (table.column, rule, distinct value) with the row count. It never writes.
set -u
URL="${DATABASE_OWNER_URL:?run inside a stack wrapper}"
# The wrapper's URL carries the role as a URL-encoded "options" parameter, which psql does not decode ("+role");
# connect to the same database without the query string and set the role through PGOPTIONS instead.
export PGOPTIONS="-c role=mth_owner"
psql "${URL%%\?*}" -v ON_ERROR_STOP=1 -qAt <<'SQL'
CREATE TEMP TABLE qa_hits (tbl text, col text, rule text, val text, n bigint);
DO $$
DECLARE r record; expr text; ncols int := 0;
BEGIN
  FOR r IN
    SELECT c.table_name t, c.column_name c, c.data_type dt
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
       AND (c.data_type IN ('text','character varying','character','json','jsonb')
            OR (c.data_type = 'ARRAY' AND c.udt_name IN ('_text','_varchar','_bpchar')))
     ORDER BY 1, 2
  LOOP
    ncols := ncols + 1;
    expr := CASE WHEN r.dt = 'ARRAY' THEN format('array_to_string(%I, %L)', r.c, ' | ') ELSE format('%I::text', r.c) END;
    EXECUTE format($q$INSERT INTO qa_hits SELECT %L, %L, 'gate_sql_rule', left(v, 400), count(*) FROM (SELECT %s AS v FROM %I) s
                     WHERE p5_mentions_engineering_gate(v) GROUP BY v$q$, r.t, r.c, expr, r.t);
    EXECUTE format($q$INSERT INTO qa_hits SELECT %L, %L, 'gate_wide', left(v, 400), count(*) FROM (SELECT %s AS v FROM %I) s
                     WHERE normalize(v, NFKC) ~* '(^|[^a-z0-9])d\s*[-_.]?\s*g\s*[-_.]?\s*[0-7٠-٧]([^0-9٠-٩]|$)'
                        OR v ~* 'delivery gate|بوابة التسليم|بوابات التسليم' GROUP BY v$q$, r.t, r.c, expr, r.t);
    EXECUTE format($q$INSERT INTO qa_hits SELECT %L, %L, 'internal_ref', left(v, 400), count(*) FROM (SELECT %s AS v FROM %I) s
                     WHERE v ~ '(^|[^A-Za-z0-9_])(D-[0-9]{3}|ADR-[0-9]{4}|[FT]-DG[0-9])' GROUP BY v$q$, r.t, r.c, expr, r.t);
  END LOOP;
  RAISE NOTICE 'columns scanned: %', ncols;
END $$;
\echo '## columns scanned (see NOTICE above); hits by table.column and rule'
SELECT tbl || '.' || col || ' [' || rule || '] rows=' || sum(n) || ' distinct=' || count(*) FROM qa_hits GROUP BY tbl, col, rule ORDER BY 1;
\echo '## distinct values (truncated to 400 chars); audit_event.changes values are whole JSON documents'
SELECT tbl || '.' || col || ' [' || rule || '] x' || n || ': ' || replace(val, E'\n', ' ') FROM qa_hits ORDER BY tbl, col, rule, val;
\echo '## end'
SQL
echo "scan rc=$?"
