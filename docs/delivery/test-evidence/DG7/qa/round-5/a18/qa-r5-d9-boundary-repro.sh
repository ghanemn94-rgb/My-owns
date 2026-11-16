#!/usr/bin/env bash
# qa-verifier DG7 round 5 (T-DG7-REV-QA-R5): deliberate reproduction of the A18 D9 FAIL of run 1. Builds an archive from
# the FROZEN clone (02aeed6e, candidate 07af9fba), waits until $QA_START (UTC HH:MM:SS) so that the drill's D7-D9 window
# (target worker running) contains a quarter hour (approval.escalation_scan, */15 Asia/Riyadh), runs
# deploy/scripts/transfer-drill.sh --keep, then starts the kept TARGET PostgreSQL on a host port (reads only) and
# SELECTs the automation_execution rows whose trigger is a schedule (trigger code, key, times). Nothing is changed in the
# product, the drill or the candidate; no job is paused or rescheduled. SYNTHETIC data only; nothing here approves
# anything (no G1-G6, Finance, IT or DG approval). Run under tests/qa/support/with-pg.sh.
set -u
REPO="${QA_REPO:?}"; OUT="${QA_OUT:?}"; START="${QA_START:?}"; B="$TMPDIR/qa-r5-d9"; CAND=sha256:07af9fba26f9ae435f6f3de7ca5204ed1e182a125f1fd0f912b70da06035a61d
[ -e "$B" ] && { echo "BLOCKED: $B exists"; exit 2; }
cd "$REPO"; ts() { date -u +%T; }
echo "start $(ts); HEAD $(git rev-parse HEAD); target drill start $START"
U=$(node -e 'const u=new URL(process.env.TEST_DATABASE_ADMIN_URL);u.pathname="/mth_d9_src";u.username="mth_owner";console.log(u.href)')
psql -X -q -d "$TEST_DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mth_owner') THEN CREATE ROLE mth_owner LOGIN; END IF;
IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mth_app') THEN CREATE ROLE mth_app LOGIN; END IF; END \$\$;
CREATE DATABASE mth_d9_src OWNER mth_owner ENCODING 'UTF8' TEMPLATE template0;
GRANT CONNECT ON DATABASE mth_d9_src TO mth_app;
SQL
(cd packages/db && DATABASE_OWNER_URL="$U" NODE_ENV=development node --conditions=@mth/source src/cli.ts migrate >/dev/null && \
  DATABASE_OWNER_URL="$U" NODE_ENV=development node --conditions=@mth/source src/cli.ts seed-demo | grep "reporting periods relative to") || { echo "demo db FAIL"; exit 1; }
DATABASE_OWNER_URL="$U" NODE_ENV=development node tools/migration/export.mjs --out "$B/export" --operator "transfer-drill synthetic operator" | tail -1
node tools/release/build-archive.mjs --repo "$REPO" --commit "$(git rev-parse HEAD)" --demo-data "$B/export" --candidate $CAND --out "$B/arch" | tail -1
A=$(ls "$B"/arch/*.tar.gz | head -1); S=$(sha256sum "$A" | cut -c1-64); echo "archive $(basename "$A") sha256 $S"
psql -X -q -d "$TEST_DATABASE_ADMIN_URL" -c "DROP DATABASE mth_d9_src WITH (FORCE);"; rm -rf "$B/export"
mkdir -p "$B/store" && cp -a "${QA_STORE_SRC:?}" "$B/store/v10"
now=$(date -u +%s); tgt=$(date -u -d "$START" +%s); [ "$tgt" -gt "$now" ] && { echo "waiting $((tgt-now)) s until $START"; sleep $((tgt-now)); }
mkdir -p "$OUT"; W="$B/work"
echo "--- transfer-drill.sh --keep start $(ts)"
bash deploy/scripts/transfer-drill.sh --archive "$A" --sha256 "$S" --store "$B/store" --out "$OUT" --work "$W" --keep > "$OUT/stdout.txt" 2> "$OUT/stderr.txt"
rc=$?; echo "drill exit $rc $(ts)"; grep -E '^transfer-drill: (step D[0-9]+ (start|PASS|FAIL)|PASS|FAIL)' "$OUT/stdout.txt" | cut -c1-160
grep -n "automation_" "$OUT/step-D9.log" 2>/dev/null
echo "--- kept target cluster: start on 127.0.0.1:32595 and read the schedule-triggered executions"
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
# attempt 2: pg_ctl refuses root (attempt 1, 07:45), so start the kept data directory as the drill does (as_pg: unshare
# --map-user=1000, TCP only, no Unix socket), on host port 32595.
unshare --user --map-user=1000 --map-group=1000 "$PGBIN/postgres" -D "$W/pgT/data" -p 32595 -c unix_socket_directories='' \
  -c listen_addresses=127.0.0.1 >> "$B/pgT-host.log" 2>&1 &
PGPID=$!
for _ in $(seq 1 120); do PGPASSWORD="$(cat "$W/pgT.su")" psql -h 127.0.0.1 -p 32595 -U postgres -d postgres -qAtc 'select 1' >/dev/null 2>&1 && break; sleep 0.25; done
echo "started pid $PGPID"
SU="postgres://postgres:$(cat "$W/pgT.su")@127.0.0.1:32595/mth"
psql -X -d "$SU" -P pager=off -c "SELECT e.id, e.trigger_code, e.trigger_key, e.status, e.initiating_user_id, e.created_at FROM automation_execution e WHERE e.trigger_code IN (SELECT code FROM job_schedule) ORDER BY e.created_at;" 2>&1
psql -X -d "$SU" -P pager=off -c "SELECT r.id, r.automation_execution_id, r.action_type, r.outcome, r.idempotency_key FROM automation_action_result r JOIN automation_execution e ON e.id = r.automation_execution_id WHERE e.trigger_code IN (SELECT code FROM job_schedule);" 2>&1
psql -X -d "$SU" -P pager=off -c "SELECT code, cron, timezone FROM job_schedule WHERE code = 'approval.escalation_scan';" 2>&1
kill -INT $PGPID; wait $PGPID 2>/dev/null; echo "stopped"
cp "$W/pgT/pg.log" "$OUT/pgT-pg.log" 2>/dev/null
pgrep -f "$W/pg" >/dev/null && echo "PostgreSQL left running: YES" || echo "PostgreSQL left running: none"
tail -3 "$B/pgT-host.log"; rm -rf "$B"; echo "removed $B $(ts)"
exit 0
