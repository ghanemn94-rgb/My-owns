#!/usr/bin/env bash
# devops-engineer T-DG7-DO-D9: a second QUARTER run on the SAME archive as do-d9-drill-driver.sh (copied to
# $TMPDIR/do-d9q before that driver removed it). The first driver's QUARTER_START (09:55:20) was chosen from QA's D0-D6
# time (~275 s), but this run's away drill took 227 s, so its window was expected to end before 10:00; this run aims the
# D9 restart a few seconds after 10:15:00 (start $Q_START, W0 about 227 s later). transfer-drill.sh only; no job paused
# or rescheduled. SYNTHETIC data; approves nothing (no G1-G6, Finance, IT or DG approval).
set -u
REPO="${DO_REPO:?}"; OUT="${DO_OUT:?}"; B="$TMPDIR/do-d9q"; START="${Q_START:?}"
cd "$REPO"; ts() { date -u +%T; }
A=$(ls "$B"/arch/*.tar.gz | head -1); S=$(sha256sum "$A" | cut -c1-64); echo "archive $(basename "$A") sha256 $S"
now=$(date -u +%s); tgt=$(date -u -d "$START" +%s)
[ "$tgt" -gt "$now" ] && { echo "[quarter2] waiting $((tgt-now)) s until $START"; sleep $((tgt-now)); }
o="$OUT/out-quarter2"; mkdir -p "$o"
echo "[quarter2] transfer-drill.sh start $(ts)"; t0=$(date +%s.%N)
bash deploy/scripts/transfer-drill.sh --archive "$A" --sha256 "$S" --store "$B/store" --out "$o" --work "$B/work" > "$o/stdout.txt" 2> "$o/stderr.txt"
rc=$?
echo "[quarter2] drill exit $rc end $(ts) wall $(node -e "console.log(($(date +%s.%N)-$t0).toFixed(1))") s"
grep -E '^transfer-drill: (step D[0-9]+ (PASS|FAIL)|PASS|FAIL)' "$o/stdout.txt" | cut -c1-260
grep -E 'transfer-drill: D[79]: |is not schedule-explained|schedule rule not applicable' "$o/step-D7.log" "$o/step-D9.log" | cut -c1-400
grep -n "automation_\|unexplained" "$o/step-D9.log" | cut -c1-200
node -e 'const r=require(process.argv[1]);const d=r.steps.find(s=>s.id==="D9");console.log("report D9 result",d.result,"recheck",d.recheck,"window",JSON.stringify(d.scheduleWindow),"listed",JSON.stringify((d.scheduleExplained||[]).map(x=>[x.executionId,x.triggerKey,x.slot,x.status,x.createdAt,x.actionResultIds,x.auditEvents.length])))' "$o/transfer-drill-report.json"
grep -n "approval.escalation_scan\|mth-worker started\|shutting down" "$o/worker.log" | cut -c1-200 | tail -12
sha256sum "$o/transfer-drill-report.json" "$o/schedule-explained-d9.json" "$o/reconcile-d9.json" 2>&1
pgrep -f "$B/work/pg" >/dev/null && echo "[quarter2] PostgreSQL left running: YES" || echo "[quarter2] PostgreSQL left running: none"
rm -rf "$B"; echo "[quarter2] removed $B $(ts)"
exit $rc
