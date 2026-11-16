#!/usr/bin/env bash
# qa-verifier DG7 round 6 (T-DG7-REV-QA-R6): F-DG7-971 adversarial probes on the KEPT, DISPOSABLE drill target of
# part 1 (qa-r6-a18-driver.sh). The target cluster is started on 127.0.0.1:32595 (my port range). The shipped CLI
# deploy/scripts/drill/schedule-explained.mjs is run unchanged against it:
#   B0  as the drill left it (expect exit 0 and the execution listed, or exit 0 "recheck matched" if no slot was hit);
#   then one mutation at a time (committed with session_replication_role = replica so the immutability triggers do not
#   fire; restored from saved copies after each probe), each expected to give exit 1 with the A5.4 reason:
#   P1  initiating user (run_as initiating_user + a user id)            -> S2 "has an initiating user"
#   P2  event trigger code + a schedule-format key of that code           -> S3 "is not a schedule trigger"
#   P3  key names a schedule-kind trigger with no job_schedule row, or the job_schedule row disabled -> S5
#   P4  key minute moved to a real cron slot 15 min before the window      -> S7 "outside the window"
#   P5  key minute two minutes after the slot (not an occurrence)         -> S6 "names no slot"
#   P6  created_at moved before W0                                         -> S8 "created ... outside the window"
#   P7  a second execution for the same slot (key slot+1 min, not listed) -> uniqueness "has 2 executions"
#   P8  the execution's own worker event re-attributed to a user          -> S9
#   P9  the recheck text with an extra unexplained table (approval_request changed) -> Gate 0 not applicable
#   P10 the recheck text with an "unexplained changed" automation_execution key -> Gate 0 not applicable
#   P11 the package already holds the execution id (a changed row)        -> S1 "not added"
#   B1  restored state again (expect the B0 result), and digests of job_schedule and pgboss.schedule before/after.
# SYNTHETIC drill data in a disposable cluster; nothing in the candidate is changed; nothing here approves anything.
set -u
W="${QA_W:?}"; P1="${QA_P1:?}"; O="${QA_PROBE_OUT:?}"; mkdir -p "$O"
REPO="$(pwd)"; PORT="${QA_PROBE_PORT:-32595}"
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
[ -d "$W/pgT/data" ] || { echo "BLOCKED: no kept target data dir"; exit 2; }
unshare --user --map-user=1000 --map-group=1000 "$PGBIN/postgres" -D "$W/pgT/data" -p $PORT -c unix_socket_directories='' \
  -c listen_addresses=127.0.0.1 >> "$O/pgT-host.log" 2>&1 &
PGPID=$!
SU="postgres://postgres:$(cat "$W/pgT.su")@127.0.0.1:$PORT/mth"
for _ in $(seq 1 120); do "$PGBIN/psql" -X -d "$SU" -qAtc 'select 1' >/dev/null 2>&1 && break; sleep 0.25; done
q() { "$PGBIN/psql" -X -v ON_ERROR_STOP=1 -qAt -d "$SU" -c "$1"; }
qr() { "$PGBIN/psql" -X -v ON_ERROR_STOP=1 -qAt -d "$SU" <<SQL
SET session_replication_role = replica;
$1
SQL
}
W0=$(node -e 'console.log(require(process.argv[1]).window.start)' "$P1/schedule-explained-d9.json")
W1=$(node -e 'console.log(require(process.argv[1]).window.end)' "$P1/schedule-explained-d9.json")
X=$(node -e 'const r=require(process.argv[1]);console.log((r.executions[0]||{}).executionId||"")' "$P1/schedule-explained-d9.json")
# round-6 correction after attempt 1: the stage gets the recheck's REAL exit (0 when it matched); only the synthetic
# text probes P9/P10 pass 4 (they turn the text into a mismatch).
RX=$(node -e 'console.log(require(process.argv[1]).recheckExit)' "$P1/schedule-explained-d9.json")
echo "window $W0 .. $W1; explained execution in part 1: ${X:-none}"
cp "$W/reconcile-d9.txt" "$O/reconcile-d9.orig.txt"
digest() { q "SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) FROM job_schedule t" ; q "SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text),'')) FROM pgboss.schedule t"; }
stage() { # $1 name, $2 reconcile file, $3 package dir
  node "$REPO/deploy/scripts/drill/schedule-explained.mjs" --database-url "$SU" --psql "$PGBIN/psql" --reconcile "$2" \
    --recheck-exit "${4:-$RX}" --package "${3:-$W/package}" --window-start "$W0" --window-end "$W1" --out "$O/$1.json" > "$O/$1.out" 2>&1
  local rc=$?; echo "[$1] exit $rc"; sed 's/^/    /' "$O/$1.out" | cut -c1-330; return 0
}
echo "digest before: $(digest | tr '\n' ' ')"
stage B0 "$W/reconcile-d9.txt"
echo "digest after B0 (the stage alone): $(digest | tr '\n' ' ')"
if [ -z "$X" ]; then
  echo "no schedule-explained execution in part 1 (window held no slot): the DB probes P1-P8, P11 cannot run on this target"
else
  q "CREATE TABLE qa_x AS SELECT * FROM automation_execution WHERE id = '$X'"
  q "CREATE TABLE qa_ev AS SELECT * FROM audit_event WHERE record_type = 'automation_execution' AND record_id = '$X'"
  q "CREATE TABLE qa_js AS SELECT * FROM job_schedule"
  echo "execution: $(q "SELECT trigger_code||' '||trigger_key||' '||run_as||' created '||created_at FROM automation_execution WHERE id='$X'")"
  restore() {
    qr "DELETE FROM automation_execution WHERE id = '$X'; INSERT INTO automation_execution SELECT * FROM qa_x;
        UPDATE audit_event a SET actor_user_id = e.actor_user_id, actor_type = e.actor_type FROM qa_ev e WHERE a.id = e.id;
        UPDATE job_schedule j SET enabled = s.enabled FROM qa_js s WHERE j.id = s.id;"; }
  KEY=$(q "SELECT trigger_key FROM automation_execution WHERE id='$X'"); CODE=${KEY%%:*}
  SLOT=$(node -e 'console.log(require(process.argv[1]).executions[0].slot)' "$P1/schedule-explained-d9.json")
  key_at() { node -e 'const d=new Date(Date.parse(process.argv[1])+Number(process.argv[2])*60000);console.log(process.argv[3]+":"+d.toISOString().slice(0,16))' "$SLOT" "$1" "$2"; }
  USERID=$(q "SELECT id FROM app_user ORDER BY id LIMIT 1")
  EVCODE=$(q "SELECT code FROM automation_trigger WHERE trigger_kind <> 'schedule' AND code ~ '^[a-z_]+\.[a-z_]+\$' ORDER BY code LIMIT 1")
  ORPHAN=$(q "SELECT code FROM automation_trigger WHERE trigger_kind = 'schedule' AND code NOT IN (SELECT code FROM job_schedule) AND code ~ '^[a-z_]+\.[a-z_]+\$' ORDER BY code LIMIT 1")
  echo "probe inputs: key $KEY slot $SLOT user $USERID event trigger ${EVCODE:-none} schedule trigger without job_schedule row ${ORPHAN:-none}"

  qr "UPDATE automation_execution SET run_as = 'initiating_user', initiating_user_id = '$USERID' WHERE id = '$X';"; stage P1-initiating-user "$W/reconcile-d9.txt"; restore
  if [ -n "$EVCODE" ]; then
    qr "UPDATE automation_execution SET trigger_code = '$EVCODE', trigger_key = '$(key_at 0 "$EVCODE")' WHERE id = '$X';"; stage P2-event-trigger "$W/reconcile-d9.txt"; restore
  else echo "[P2-event-trigger] not run: no event trigger code"; fi
  if [ -n "$ORPHAN" ]; then
    qr "UPDATE automation_execution SET trigger_code = '$ORPHAN', trigger_key = '$(key_at 0 "$ORPHAN")' WHERE id = '$X';"; stage P3a-unscheduled-code "$W/reconcile-d9.txt"; restore
  else echo "[P3a-unscheduled-code] not run: every schedule-kind trigger has a job_schedule row"; fi
  qr "UPDATE job_schedule SET enabled = false WHERE code = '$CODE';"; stage P3b-schedule-disabled "$W/reconcile-d9.txt"; restore
  qr "UPDATE automation_execution SET trigger_key = '$(key_at -15 "$CODE")' WHERE id = '$X';"; stage P4-slot-before-window "$W/reconcile-d9.txt"; restore
  qr "UPDATE automation_execution SET trigger_key = '$(key_at 2 "$CODE")' WHERE id = '$X';"; stage P5-key-two-minutes-late "$W/reconcile-d9.txt"; restore
  qr "UPDATE automation_execution SET created_at = '$W0'::timestamptz - interval '5 seconds' WHERE id = '$X';"; stage P6-created-before-W0 "$W/reconcile-d9.txt"; restore
  qr "INSERT INTO automation_execution SELECT (substr(md5(random()::text),1,8)||'-0000-7000-8000-'||substr(md5(random()::text),1,12))::uuid, automation_rule_id, automation_rule_version_id, trigger_code, '$(key_at 1 "$CODE")', trigger_payload, organization_id, transformation_id, run_as, initiating_user_id, status, conditions_met, attempt_no, error_code, error_detail, started_at, finished_at, version, created_at, created_by, updated_at, updated_by FROM qa_x;"
  stage P7-second-execution-same-slot "$W/reconcile-d9.txt"
  qr "DELETE FROM automation_execution WHERE trigger_key = '$(key_at 1 "$CODE")';"; restore
  qr "UPDATE audit_event SET actor_user_id = '$USERID', actor_type = 'user' WHERE record_type = 'automation_execution' AND record_id = '$X';"; stage P8-event-with-user "$W/reconcile-d9.txt"; restore
  cp -a "$W/package/tables" "$O/pkg-tables-tmp" 2>/dev/null; mkdir -p "$O/pkg11"; cp -a "$W/package/." "$O/pkg11/"
  q "SELECT row_to_json(t) FROM qa_x t" >> "$O/pkg11/tables/automation_execution.ndjson"
  stage P11-execution-in-package "$W/reconcile-d9.txt" "$O/pkg11"; rm -rf "$O/pkg11" "$O/pkg-tables-tmp"
fi
# Text probes (independent of a hit): built from the real recheck text.
node -e '
const fs=require("fs");const [src,o]=process.argv.slice(1);const t=fs.readFileSync(src,"utf8").replace(/\n$/,"").split("\n");
const fin=t.findIndex(l=>/^reconcile-migration: mismatch: \d+ tables/.test(l));
const bump=(lines,k)=>lines.map(l=>l.replace(/^reconcile-migration: mismatch: (\d+) tables/,(m,n)=>"reconcile-migration: mismatch: "+(Number(n)+k)+" tables"));
const p9=[...t.slice(0,fin),"  approval_request: 0 added, 1 changed, 0 missing (audit_explained)","    unexplained changed [\"01a1e000-0000-7000-8000-000000000001\"]",...t.slice(fin)];
fs.writeFileSync(o+"/reconcile-P9.txt",bump(p9,1).join("\n")+"\n");
const i=t.findIndex(l=>/^  automation_execution: \d+ added/.test(l));
const p10=i<0?t:[...t.slice(0,i+1),"    unexplained changed [\"01a1e000-0000-7000-8000-000000000002\"]",...t.slice(i+1)];
fs.writeFileSync(o+"/reconcile-P10.txt",p10.join("\n")+"\n");' "$W/reconcile-d9.txt" "$O"
stage P9-extra-table "$O/reconcile-P9.txt" "" 4
stage P10-changed-execution "$O/reconcile-P10.txt" "" 4
[ -n "$X" ] && { q "DROP TABLE qa_x; DROP TABLE qa_ev; DROP TABLE qa_js"; }
stage B1-restored "$W/reconcile-d9.txt"
echo "digest after: $(digest | tr '\n' ' ')"
kill -INT $PGPID; wait $PGPID 2>/dev/null; echo "kept target stopped"
exit 0
