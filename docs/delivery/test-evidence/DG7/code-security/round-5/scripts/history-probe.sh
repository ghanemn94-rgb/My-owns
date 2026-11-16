#!/usr/bin/env bash
# DG7 round 5 (code-security-reviewer): independent probe of the F-DG7-922/941/970 repair.
# Usage: history-probe.sh <repo-root-readonly> <scratch-dir>
# Runs read-only against <repo-root>; all mutation happens in a disposable --shared clone under <scratch-dir>.
# v2: run 1 (10-history-probe-run1.log) hit ENOSPC in P3 (a stale full clone filled $TMPDIR) and used
#     invariants stricter than the validator over all stages. v2 makes the DG7 repair invariants strict and
#     reports pre-existing, unchanged history oddities of other stages as INFO only.
set -u
REPO="$1"; SCR="$2"
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
rc=0

echo "== P1: DG7 history invariants (strict) + other-stage time order (INFO) =="
node - "$REPO/docs/delivery/stages.json" <<'EOF' || rc=1
const fs = require("fs");
const doc = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
let bad = 0;
for (const s of doc.stages) {
  for (let i = 1; i < s.history.length; i++) {
    if (Date.parse(s.history[i].at) < Date.parse(s.history[i - 1].at)) {
      if (s.id === "DG7") { bad++; console.log(`STRICT not monotone DG7 [${i - 1}] > [${i}]`); }
      else console.log(`INFO pre-existing non-monotone ${s.id} [${i - 1}]${s.history[i - 1].state}@${s.history[i - 1].at} > [${i}]${s.history[i].state}@${s.history[i].at}`);
    }
  }
}
const g = doc.stages.find((x) => x.id === "DG7");
console.log("DG7 history:", g.history.map((h) => `${h.state}@${h.at}`).join(" -> "));
console.log("DG7 history time-monotone:", g.history.every((h, i) => i === 0 || Date.parse(h.at) >= Date.parse(g.history[i - 1].at)));
const revIdx = g.history.map((h, i) => (h.state === "REVIEWING" ? i : -1)).filter((i) => i >= 0);
const rounds = g.review_rounds;
if (revIdx.length !== rounds.length) { bad++; console.log(`STRICT: ${revIdx.length} REVIEWING entries vs ${rounds.length} review rounds`); }
rounds.forEach((r, k) => {
  const h = g.history[revIdx[k]];
  const d = h ? (Date.parse(h.at) - Date.parse(r.frozen_at)) / 1000 : NaN;
  const ok = h && d >= 0 && d < 120; // the REVIEWING entry follows the freeze within the freeze commit
  if (!ok) bad++;
  console.log(`round ${r.round}: frozen_at ${r.frozen_at}  REVIEWING ${h ? h.at : "missing"}  delta ${d}s  ${ok ? "OK" : "BAD"}${d > 0 ? " (INFO: entry written by the freeze commit after the manifest time)" : ""}`);
});
for (let k = 0; k < revIdx.length - 1; k++) {
  const between = g.history.slice(revIdx[k] + 1, revIdx[k + 1]);
  const ok = between.length === 1 && between[0].state === "FIXING"
    && Date.parse(between[0].at) > Date.parse(g.history[revIdx[k]].at)
    && Date.parse(between[0].at) < Date.parse(g.history[revIdx[k + 1]].at);
  if (!ok) bad++;
  console.log(`between round ${k + 1} and ${k + 2}: [${between.map((h) => h.state + "@" + h.at).join(",")}] ${ok ? "OK" : "BAD"}`);
}
const last = g.history.at(-1);
const curOk = g.state === "REVIEWING" && last.state === "REVIEWING" && g.candidate.candidate_id === rounds.at(-1).candidate_id && g.candidate.source_commit === rounds.at(-1).source_commit;
if (!curOk) bad++;
console.log(`stage=${g.state} last=${last.state} candidate=${g.candidate.candidate_id} matches round ${rounds.at(-1).round}: ${curOk}`);
console.log(bad ? `P1 FAIL (${bad})` : "P1 PASS");
process.exit(bad ? 1 : 0);
EOF

echo "== P2: late entry timestamp vs git history (round-3 findings import commit) =="
late_at=$(node -e 'const d=require(process.argv[1]);const g=d.stages.find(x=>x.id==="DG7");const h=g.history.filter(h=>/recorded late/.test(h.note||""));console.log(h.length+" "+(h[0]?h[0].at:"none"))' "$REPO/docs/delivery/stages.json")
echo "entries marked 'recorded late' (count, at): $late_at"
git -C "$REPO" log --format='%h %cI %s' 1d04f8381^..471072d6481a346c356e985d07b49721ebdda571 | grep -E 'round-3|import' || true
imp=$(git -C "$REPO" show -s --format=%cI 5458273cd | sed 's/+00:00$/Z/')
echo "import commit 5458273cd committed at: $imp"
if [ "$late_at" = "1 $imp" ]; then echo "P2 PASS (exactly one late entry; its time = import of round-3 findings, D-276)"; else echo "P2 FAIL"; rc=1; fi
echo "-- entries changed or removed by the repair (9d5691143 vs freeze a76c2aed4), DG7 history only:"
node -e '
const {execFileSync}=require("child_process");const r=process.argv[1];
const get=(c)=>JSON.parse(execFileSync("git",["-C",r,"show",c+":docs/delivery/stages.json"],{maxBuffer:1<<28})).stages.find(s=>s.id==="DG7").history.map(h=>JSON.stringify(h));
const a=get("a76c2aed4"),b=get("9d5691143");
const removed=a.filter(x=>!b.includes(x)),added=b.filter(x=>!a.includes(x));
console.log("removed/changed:",removed.length);removed.forEach(x=>console.log("  -",x));
console.log("added:",added.length);added.forEach(x=>console.log("  +",x.slice(0,160)));
const order=a.every((x,i)=>b.indexOf(x)>(i?b.indexOf(a[i-1]):-1));console.log("pre-existing entries kept in order:",order);
process.exit(removed.length===0&&order?0:1)' "$REPO" || rc=1

echo "== P3: mutation — remove the late FIXING entry in a disposable --shared clone; validator must fail again =="
C="$SCR/probe-clone"; rm -rf "$C"
git clone -q --shared "$REPO" "$C" && git -C "$C" checkout -q 02aeed6e434ec1511795302ebd5efbec90eb90c2 || { echo "P3 clone FAILED"; rc=1; }
node "$C/tools/gates/validate.mjs" --historical --stage DG6 > "$SCR/p3-control.log" 2>&1; c0=$?
echo "control (unmodified 02aeed6e4): --historical --stage DG6 exit=$c0"; cat "$SCR/p3-control.log" | head -5
node -e '
const fs=require("fs");const p=process.argv[1];const d=JSON.parse(fs.readFileSync(p,"utf8"));
const g=d.stages.find(x=>x.id==="DG7");const n=g.history.length;
g.history=g.history.filter(h=>!/recorded late/.test(h.note||""));
console.log(`removed ${n-g.history.length} entry`);fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");' "$C/docs/delivery/stages.json"
node "$C/tools/gates/validate.mjs" --historical --stage DG6 > "$SCR/p3-mutant.log" 2>&1; c1=$?
echo "mutant (late entry removed): --historical --stage DG6 exit=$c1 (expected non-zero)"; cat "$SCR/p3-mutant.log" | head -5
if [ $c0 -eq 0 ] && [ $c1 -ne 0 ] && grep -q "illegal transition REVIEWING -> REVIEWING" "$SCR/p3-mutant.log"; then echo "P3 PASS (the validator detects the round-4 defect class; the inserted entry is what makes it pass)"; else echo "P3 FAIL"; rc=1; fi
rm -rf "$C"
echo "probe exit=$rc"
exit $rc
