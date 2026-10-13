#!/usr/bin/env bash
# domain-reviewer DG4 round 10 (T-DG4-REV-DOM-R10): candidate identity on a complete clone, and the product diff
# from round 9's source f2ae717 to this round's source e70ac02 (assignment items 1 and 2).
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:/usr/bin:/bin
R=/home/user/My-owns
C="$TMPDIR/review-r10"
echo "### repo HEAD $(cd $R && git rev-parse HEAD)"
echo "### repo candidate"; (cd $R && node tools/gates/candidate.mjs --stage DG4); echo "### exit=$?"
echo "### repo: commits e70ac02..HEAD touch only docs/delivery/ (non-docs/delivery lines below, expected none):"
(cd $R && git diff --name-only e70ac02 HEAD | grep -v '^docs/delivery/'); echo "### (grep exit=$? ; 1 = none)"
cd "$C"
git checkout -q 01a801e5fe03683a4ba8f33e42af3d9e03f2ba40
echo "### clone HEAD $(git rev-parse HEAD) shallow=$(git rev-parse --is-shallow-repository) commits=$(git rev-list --count HEAD)"
echo "### clone candidate (freeze commit, tracked tree)"; node tools/gates/candidate.mjs --stage DG4; echo "### exit=$?"
echo "### manifest file"; ls -l $R/docs/delivery/candidates/DG4/f38274cb6d50c498.manifest.json
python3 - <<'PY'
import json
m=json.load(open('/home/user/My-owns/docs/delivery/candidates/DG4/f38274cb6d50c498.manifest.json'))
print('manifest keys:', sorted(m.keys()) if isinstance(m,dict) else type(m))
for k in ('candidate_id','source_commit','stage','stage_id','file_count'):
    if isinstance(m,dict) and k in m: print(k, '=', m[k])
if isinstance(m,dict) and 'files' in m: print('files in manifest:', len(m['files']))
PY
echo "### product diff f2ae717..e70ac02 excluding docs/delivery"
git diff --stat f2ae7170630456a772e1ceac90ab6d96b68e3f5c..e70ac02f63cd1f42487cfa4dae73f68e933da015 -- . ':!docs/delivery'
echo "### file count: $(git diff --name-only f2ae7170630456a772e1ceac90ab6d96b68e3f5c..e70ac02f63cd1f42487cfa4dae73f68e933da015 -- . ':!docs/delivery' | wc -l)"
echo "### round-9 manifest source pointer (f2ae717 = round 9 candidate 18c18fe4?)"
ls $R/docs/delivery/candidates/DG4/ | grep 18c18fe4
python3 -c "import json;m=json.load(open('$(ls $R/docs/delivery/candidates/DG4/18c18fe4*.json | head -1)'));print({k:m[k] for k in m if k in ('candidate_id','source_commit')})"
