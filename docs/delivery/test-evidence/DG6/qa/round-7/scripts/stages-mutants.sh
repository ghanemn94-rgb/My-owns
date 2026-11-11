#!/bin/bash
# qa-verifier DG6 RG round 7: F-DG6-911/951 mutants on the main repository's stages.json (read-only: the mutant is served
# in memory by tests/round-6/stages-serve-mutant.mjs via node --import). M0 = re-serialized control; M1 = the e7cb240e7
# FIXING entry (06:42:33Z) removed (fix reverted); M2 = DG6 state field set to FIXING while the last entry is REVIEWING.
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
cd /home/user/My-owns
H=docs/delivery/test-evidence/DG6/qa/tests/round-6/stages-serve-mutant.mjs
mkdir -p $TMPDIR/mut
python3 - <<'PY'
import json,os
t=os.environ['TMPDIR']+'/mut/'
s=json.load(open('docs/delivery/stages.json'))
json.dump(s,open(t+'m0-control.json','w'),indent=2)
import copy
m1=copy.deepcopy(s); d=[x for x in m1['stages'] if x['id']=='DG6'][0]
before=len(d['history']); d['history']=[e for e in d['history'] if e['at']!='2026-11-11T06:42:33Z']; print('M1 removed',before-len(d['history']),'entry')
json.dump(m1,open(t+'m1-no-0642-fixing.json','w'),indent=2)
m2=copy.deepcopy(s); [x for x in m2['stages'] if x['id']=='DG6'][0]['state']='FIXING'
json.dump(m2,open(t+'m2-state-fixing.json','w'),indent=2)
PY
echo "## $(date -u +%FT%TZ) HEAD $(git rev-parse HEAD) node $(node -v); git status of stages.json: [$(git status --short docs/delivery/stages.json)]"
for m in m0-control m1-no-0642-fixing m2-state-fixing; do
 for a in "--historical --stage DG5" "--historical --stage DG1" "--pipeline"; do
  echo "### $m: node --import $H tools/gates/validate.mjs $a"
  MUT_STAGES=$TMPDIR/mut/$m.json node --import ./$H tools/gates/validate.mjs $a 2>&1; echo "rc=$?"
 done
done
echo "## after: git status of stages.json: [$(git status --short docs/delivery/stages.json)]"
