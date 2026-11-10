#!/usr/bin/env bash
# qa-verifier T-DG6-QA-H: the root e2e run (one Playwright invocation over the files given) with a monitor of the
# automation.evaluate / notifications.fanout queues, worker heartbeats and active SQL every 20 s (MONLOG).
# Run inside apps/web/e2e/support/with-stack.sh from the repository root.
set -uo pipefail
MON="${MONLOG:?}"
U="${DATABASE_OWNER_URL%%\?*}"
( while :; do
  { echo "----- $(date -u +%T)"
    PGOPTIONS="-c role=mth_owner" psql "$U" -X -qAt -F' | ' -c "
SELECT 'jobs', name, state, count(*), min(created_on)::time, max(created_on)::time FROM pgboss.job WHERE name IN ('automation.evaluate','notifications.fanout') AND state IN ('created','retry','active') GROUP BY 1,2,3 ORDER BY 2,3;
SELECT 'active', id, name, started_on::time, retry_count FROM pgboss.job WHERE state='active';
SELECT 'evalerr', state, retry_count, created_on::time, left(regexp_replace(output::text,'\s+',' ','g'),200) FROM pgboss.job WHERE name='automation.evaluate' AND state IN ('retry','failed') AND created_on > now() - interval '10 minutes' ORDER BY created_on DESC LIMIT 3;
SELECT 'eval-done-last-20s', count(*) FROM pgboss.job WHERE name='automation.evaluate' AND completed_on > now() - interval '20 seconds';
SELECT 'hb', instance_key, last_beat_at::time FROM worker_heartbeat ORDER BY last_beat_at DESC LIMIT 3;
SELECT 'act', pid, application_name, state, wait_event_type, wait_event, (now()-query_start)::text, left(regexp_replace(query,'\s+',' ','g'),160) FROM pg_stat_activity WHERE state <> 'idle' AND pid <> pg_backend_pid() AND backend_type='client backend';
" 2>&1; } >> "$MON"
  sleep 20; done ) &
P=$!
npx playwright test "$@" --workers=1 --reporter=list --output="${OUTD:-$TMPDIR/full-out}"
RC=$?
kill $P
exit $RC
