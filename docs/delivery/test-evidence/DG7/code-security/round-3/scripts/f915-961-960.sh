#!/bin/bash
# F-DG7-915 / F-DG7-961 (release notes) and F-DG7-960 (C3 disclosure): checks on the candidate, then revert-to-fail.
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/code-security/round-3
cd $TMPDIR/rv
RN="node tools/release/release-notes.mjs --csv docs/delivery/requirements.csv --deps docs/handover/external-dependencies.json --provisional apps/web/src/i18n --out docs/handover/release-notes.md"
{
echo "# $(date -u +%FT%TZ) F-DG7-915/961/960 (Node $(node -v), cwd \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), git status lines $(git status --short | wc -l))"
echo "== A. register hash vs the hash the release notes state"
sha256sum docs/delivery/requirements.csv
grep -n "SHA-256" docs/handover/release-notes.md | head -5
echo "== B. release-notes --check on the candidate"
$RN --check; echo "exit=$?"
echo "== C. the REQ-S19-015 entry and Q19 marker lines in the release notes (count of completes-after-gate mentions)"
grep -c "completes-after-gate" docs/handover/release-notes.md
grep -n "REQ-S19-015" docs/handover/release-notes.md | head -3 | cut -c1-300
echo "== D. revert-to-fail 1: the round-2 release notes (git show f22c97b59:docs/handover/release-notes.md) against this register"
cp docs/handover/release-notes.md $TMPDIR/rn.keep
git show f22c97b5931a40969574f4e646ea480be4454861:docs/handover/release-notes.md > docs/handover/release-notes.md
$RN --check; echo "exit=$? (expected 1)"
cp $TMPDIR/rn.keep docs/handover/release-notes.md
echo "== E. revert-to-fail 2: one register note changed by one character, release notes unchanged"
cp docs/delivery/requirements.csv $TMPDIR/csv.keep
python3 - <<'PY'
import re
p='docs/delivery/requirements.csv'; s=open(p,encoding='utf-8').read()
i=s.index('completes-after-gate:'); s=s[:i]+'Completes-after-gate:'+s[i+len('completes-after-gate:'):]
open(p,'w',encoding='utf-8').write(s)
PY
git diff --stat
$RN --check; echo "exit=$? (expected 1 if the changed row is listed in the notes; 0 is possible for a row not quoted)"
cp $TMPDIR/csv.keep docs/delivery/requirements.csv
echo "== F. is release-notes --check on the real tree now a test? (grep tools/release/tests for the real register path with --check)"
grep -ln "docs/handover/release-notes.md" tools/release/tests/*.mjs tests/qa -r 2>/dev/null | head
echo "== G. protocol audit on this candidate (stage DG7, JSON into \$TMPDIR) vs protocol-audit-r3.json"
node tools/release/protocol-audit.mjs --stage DG7 --root /home/user/My-owns --json $TMPDIR/pa-dg7.json > $TMPDIR/pa-dg7.txt 2>&1; echo "exit=$? (1 = hits present)"
python3 - <<'PY'
import json,os,collections
T=os.environ['TMPDIR']
def summ(p):
    d=json.load(open(p))
    hits=d.get('hits') or d.get('findings') or []
    c=collections.Counter()
    for h in hits:
        if h.get('stage','DG7')=='DG7' or h.get('stage_id')=='DG7': c[h.get('check') or h.get('id')]+=1
    return d,hits,c
for p in [T+'/pa-dg7.json','docs/delivery/test-evidence/DG7/orchestrator/protocol-audit/protocol-audit-r3.json']:
    d,h,c=summ(p); print(p.split('/')[-1], 'keys', list(d.keys())[:8], 'DG7 hits by check', dict(c))
d,h,c=summ(T+'/pa-dg7.json')
for x in h:
    if (x.get('check') or x.get('id'))=='C3': print('C3', json.dumps(x)[:300])
PY
echo "== H. known-limitations C3 row and --check against protocol-audit-r3"
grep -n "C3\|C2 \|C5 " docs/handover/known-limitations.md | head
node tools/release/known-limitations.mjs --protocol-audit docs/delivery/test-evidence/DG7/orchestrator/protocol-audit/protocol-audit-r3.json --check; echo "exit=$?"
echo "== I. check-handover (strict and default) with protocol-audit-r3"
node tools/release/check-handover.mjs --protocol-audit docs/delivery/test-evidence/DG7/orchestrator/protocol-audit/protocol-audit-r3.json 2>&1 | tail -4; echo "exit=${PIPESTATUS[0]}"
MTH_STRICT_HANDOVER=1 node tools/release/check-handover.mjs --protocol-audit docs/delivery/test-evidence/DG7/orchestrator/protocol-audit/protocol-audit-r3.json 2>&1 | tail -4; echo "exit=${PIPESTATUS[0]}"
echo "== J. FE-C3 handback headings and the new round-2 repair handbacks' headings"
for f in docs/delivery/handbacks/DG7/T-DG7-FE-C3-frontend-ux-engineer.md docs/delivery/handbacks/DG7/T-DG7-AN-P7F-transformation-analyst.md docs/delivery/handbacks/DG7/T-DG7-BE-R7-backend-workflow-engineer.md docs/delivery/handbacks/DG7/T-DG7-DO-D8-devops-engineer.md docs/delivery/handbacks/DG7/T-DG7-DO-D8B-devops-engineer.md; do echo "-- $f"; grep -n "^#" $f | head -12; done
echo "== final git status (must be clean)"; git status --short | head
echo "# end $(date -u +%FT%TZ)"
} > $E/20-f915-f961-f960.log 2>&1
