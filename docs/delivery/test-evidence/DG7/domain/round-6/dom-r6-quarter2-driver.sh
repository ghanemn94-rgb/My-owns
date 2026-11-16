#!/usr/bin/env bash
# domain-reviewer DG7 round 6: a second QUARTER run on the SAME archive as dom-r6-drill-driver.sh. The first quarter
# run's W0 fell 29.8 s AFTER 12:45:00 (D0 took 234 s under load), the worker's first cron tick came >60 s after the
# slot, so no escalation_scan execution was created and the recheck matched (nothing for the rule to explain). This run
# aims W0 about 10 s BEFORE 13:00:00 (start $Q_START, D0-D6 measured 278 s). transfer-drill.sh only; no job paused or
# rescheduled. SYNTHETIC data; approves nothing (no G1-G6, Finance, IT or DG approval).
set -u
REPO="${DR_REPO:?}"; OUT="${DR_OUT:?}"; B="${DR_B:?}"; START="${Q_START:?}"
cd "$REPO"; ts() { date -u +%T; }
A=$(ls "$B"/arch/*.tar.gz | head -1); S=$(sha256sum "$A" | cut -c1-64); echo "archive $(basename "$A") sha256 $S; free $(df -Pm "$TMPDIR" | awk 'NR==2{print $4}') MB"
now=$(date -u +%s); tgt=$(date -u -d "$START" +%s)
[ "$tgt" -gt "$now" ] && { echo "[quarter2] waiting $((tgt-now)) s until $START"; sleep $((tgt-now)); }
o="$OUT/out-quarter2"; mkdir -p "$o"
echo "[quarter2] transfer-drill.sh start $(ts)"; t0=$(date +%s)
bash deploy/scripts/transfer-drill.sh --archive "$A" --sha256 "$S" --store "$B/store" --out "$o" --work "$B/work-quarter2" > "$o/stdout.txt" 2> "$o/stderr.txt"
rc=$?
echo "[quarter2] drill exit $rc end $(ts) wall $(( $(date +%s)-t0 )) s; stderr lines $(wc -l < "$o/stderr.txt")"
grep -E '^transfer-drill: (step D[0-9]+ (PASS|FAIL)|PASS|FAIL)' "$o/stdout.txt" | cut -c1-260
grep -hE 'transfer-drill: D[79]: |is not schedule-explained|schedule rule not applicable|step D9 failed' "$o/step-D7.log" "$o/step-D9.log" | cut -c1-400
grep -n "automation_\|unexplained" "$o/step-D9.log" | cut -c1-200
node -e 'const r=require(process.argv[1]);const d=r.steps.find(s=>s.id==="D9");console.log("report result",r.result,"D9",d.result,"recheck",d.recheck,"window",JSON.stringify(d.scheduleWindow),"listed",JSON.stringify((d.scheduleExplained||[]).map(x=>[x.executionId,x.triggerKey,x.slot,x.status,x.createdAt,x.initiatingUserId,x.runAs,x.triggerKind,x.actionResultIds.length,x.auditEvents.length])))' "$o/transfer-drill-report.json"
grep -n "approval.escalation_scan\|mth-worker started\|shutting down" "$o/worker.log" | cut -c1-220 | tail -8
sha256sum "$o/transfer-drill-report.json" "$o/schedule-explained-d9.json" "$o/reconcile-d9.json" 2>&1
pgrep -f "$B/work-quarter2/pg" >/dev/null && echo "[quarter2] PostgreSQL left running: YES" || echo "[quarter2] PostgreSQL left running: none"
rm -rf "$B/work-quarter2"; echo "[quarter2] removed work tree $(ts)"
exit $rc
