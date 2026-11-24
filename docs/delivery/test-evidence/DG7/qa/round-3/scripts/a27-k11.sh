#!/usr/bin/env bash
# qa-verifier DG7 round 3: independent A27 resumption re-drill (REQ-S20-027, REQ-DLV-030 incl. the K11 clause
# "work continues from progress.md"). Checkpoint = e44dcd90e (the D-281 clean re-gate commit, DG7 BUILDING).
#  K9  candidate at the checkpoint (--ref) from the main repository
#  K10 validate --reconcile in a shared sparse clone at the checkpoint (no runs/handbacks/test-evidence/apps/packages)
#  K11 the next action written in progress.md at the checkpoint vs. the commits that actually followed
#  K12 validate --pipeline at the checkpoint: no stage past DG6 approved; no gates/DG7.json
#  K13 every run after the checkpoint has a new session id (none reused)
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
M=/home/user/My-owns; C="$TMPDIR/k11"; CP=e44dcd90e30714f3f0956f24561bc49183478b96; END=557a95133f4825e77d930500c1298df17549029e
rm -rf "$C"; git clone -q --shared --no-checkout "$M" "$C" && git -C "$C" sparse-checkout set --no-cone "/*" "!/docs/delivery/test-evidence/" "!/docs/delivery/handbacks/" "!/docs/delivery/runs/" "!/trading_agent/" && git -C "$C" checkout -q $CP || exit 2
echo "## K9 candidate at checkpoint"; (cd "$M" && node tools/gates/candidate.mjs --stage DG7 --ref $CP); echo "exit=$?"
echo "## K10 reconcile at checkpoint (clone HEAD $(git -C "$C" rev-parse HEAD))"; (cd "$C" && node tools/gates/validate.mjs --reconcile 2>&1 | tail -25); echo "exit=${PIPESTATUS[0]}"
echo "## K11 progress.md 'Next action' at checkpoint"; git -C "$M" show $CP:docs/delivery/progress.md | grep -o '\*\*Next action:\*\*[^.]*\.[^-]*' | head -2
echo "## K11 commits after checkpoint (what actually happened)"; git -C "$M" log --reverse --format='%h %s' $CP..$END
echo "## K11 files of each following commit (first 8)"; for c in $(git -C "$M" rev-list --reverse $CP..$END); do echo "-- $(git -C "$M" log -1 --format=%h $c)"; git -C "$M" show --name-only --format= $c | grep -v '^docs/delivery/test-evidence/' | head -8; done
echo "## K11 stages.json DG7 at checkpoint and now"; for r in $CP $END; do git -C "$M" show $r:docs/delivery/stages.json | python3 -c "import json,sys; s=[x for x in json.load(sys.stdin)['stages'] if x['id']=='DG7'][0]; print('$r'[:9], s['state'], [ (r['round'], r['candidate_id'][:15]) for r in s.get('review_rounds',[])])"; done
echo "## K12 pipeline at checkpoint"; (cd "$C" && node tools/gates/validate.mjs --pipeline 2>&1 | tail -5); echo "exit=${PIPESTATUS[0]}"
echo "gates/DG7.json at checkpoint: $(git -C "$M" cat-file -e $CP:docs/delivery/gates/DG7.json 2>/dev/null && echo PRESENT || echo absent); now: $([ -e "$M/docs/delivery/gates/DG7.json" ] && echo PRESENT || echo absent)"
echo "## K13 session ids of DG7 runs"; python3 - "$M" <<'EOF'
import json,glob,sys,collections
m=sys.argv[1]; ids=collections.Counter(); n=0
for p in glob.glob(m+'/docs/delivery/runs/*/*/meta.json'):
    j=json.load(open(p)); s=j.get('result_session_id') or (j.get('invocation_reference') or {}).get('session_id')
    if s: ids[s]+=1; n+=1
dup=[s for s,c in ids.items() if c>1]
print('runs with a session id:',n,'distinct:',len(ids),'reused:',dup)
EOF
rm -rf "$C"; echo "clone removed"
