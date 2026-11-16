#!/usr/bin/env bash
# code-security-reviewer DG7 round 6: a third transfer-drill.sh run on the SAME archive as drill-driver.sh (copied to
# $TMPDIR/cs-q2/arch before that driver removed it), aimed so the D7-D9 window contains 13:00:00Z (the first QUARTER run
# started at 12:40:50 reached W0 at 12:45:26.553Z, 26 s after the slot, and pg-boss did not send it). Starts at $Q_START
# after drill-driver.sh has finished (its $TMPDIR/cs-d9 removed). No job paused or rescheduled. SYNTHETIC; approves nothing.
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
REPO="$TMPDIR/rv"; OUT="${CS_OUT:?}"; B="$TMPDIR/cs-q2"; START="${Q_START:?}"
cd "$REPO"; ts() { date -u +%T; }
while [ -e "$TMPDIR/cs-d9" ]; do sleep 5; done
A=$(ls "$B"/arch/*.tar.gz | head -1); S=$(sha256sum "$A" | cut -c1-64); echo "archive $(basename "$A") sha256 $S"
mkdir -p "$B/store" && cp -a /root/.local/share/pnpm/store/v10 "$B/store/v10"
now=$(date -u +%s); tgt=$(date -u -d "$START" +%s)
[ "$tgt" -gt "$now" ] && { echo "[quarter2] waiting $((tgt-now)) s until $START"; sleep $((tgt-now)); }
[ "$tgt" -lt "$now" ] && echo "[quarter2] WARNING: start $START already passed by $((now-tgt)) s"
o="$OUT/out-quarter2"; mkdir -p "$o"
echo "[quarter2] transfer-drill.sh start $(ts) free $(df -Pm "$TMPDIR" | awk 'NR==2{print $4}') MB"; t0=$(date +%s)
bash deploy/scripts/transfer-drill.sh --archive "$A" --sha256 "$S" --store "$B/store" --out "$o" --work "$B/work" > "$o/stdout.txt" 2> "$o/stderr.txt"
rc=$?
echo "[quarter2] drill exit $rc end $(ts) wall $(( $(date +%s)-t0 )) s; stderr lines $(wc -l < "$o/stderr.txt")"
grep -E '^transfer-drill: (step D[0-9]+ (PASS|FAIL)|PASS|FAIL)' "$o/stdout.txt" | cut -c1-200
grep -hE 'transfer-drill: D[79]: |is not schedule-explained|schedule rule not applicable|step D9 failed' "$o/step-D7.log" "$o/step-D9.log" | cut -c1-400
grep -n "automation_\|unexplained\|reconcile-migration" "$o/step-D9.log" | cut -c1-200
node -e 'const r=require(process.argv[1]);const d=r.steps.find(s=>s.id==="D9");console.log("report result",r.result,"D9",d.result,"recheck",d.recheck,"window",JSON.stringify(d.scheduleWindow),"listed",JSON.stringify((d.scheduleExplained||[]).map(x=>[x.executionId,x.triggerKey,x.slot,x.status,x.createdAt,x.actionResultIds,x.auditEvents.length])))' "$o/transfer-drill-report.json"
pgrep -f "$B/work/pg" >/dev/null && echo "[quarter2] PostgreSQL left running: YES" || echo "[quarter2] PostgreSQL left running: none"
rm -rf "$B"; echo "[quarter2] removed $B $(ts)"
exit $rc
