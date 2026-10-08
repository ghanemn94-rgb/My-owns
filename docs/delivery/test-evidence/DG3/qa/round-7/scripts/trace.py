# qa-verifier DG3 round 7: requirement -> recorded QA checks trace over the kept results JSON (both settings, both projects).
import json,re,os
E='/home/user/My-owns/docs/delivery/test-evidence/DG3/qa/round-7'
REQS="REQ-PB-004 REQ-PB-006 REQ-PB-007 REQ-PB-019 REQ-PB-022 REQ-PB-032 REQ-PB-040 REQ-PB-045 REQ-PB-046 REQ-PB-047 REQ-PB-048 REQ-PB-049 REQ-PB-050 REQ-PB-051 REQ-PB-052 REQ-PB-053 REQ-PB-054 REQ-PB-055 REQ-PB-056 REQ-PB-057 REQ-PB-059 REQ-DLV-035 REQ-S04-006 REQ-S05-005 REQ-S08-007 REQ-S09-001 REQ-S09-003 REQ-S09-004 REQ-S09-005 REQ-S09-006 REQ-S09-008 REQ-S16-016".split()
def expand(tag):
    out=[]; prefix=None
    for part in tag.split('/'):
        if part.startswith('REQ-'): out.append(part); prefix=part.rsplit('-',1)[0]
        else: out.append(f'{prefix}-{part}')
    return out
o=["Requirement -> recorded QA checks (dg3-qa-r7.spec.ts), passed/total, per setting and project. 'info' rows excluded.",
   "A check tagged 'REQ-PB-047/048' or 'REQ-PB-048/REQ-DLV-035' counts for each named requirement. Product journeys, unit and integration suites add coverage beyond this table.",""]
uncovered=set()
for mode in ['unset','cutf8']:
    o.append(f'== e2e-{mode}')
    data={l:json.load(open(f'{E}/results/e2e-{mode}-dg3-qa-r7-checks-{l}.json')) for l in ['en','ar']}
    for r in REQS:
        parts=[]; ids=None
        for l in ['en','ar']:
            rows=[x for x in data[l] if x['req']!='info' and r in expand(x['req'])]
            parts.append(f"{l} {sum(1 for x in rows if x['pass'] is True)}/{len(rows)}")
            if ids is None: ids=[x['id'] for x in rows]
            if not rows or any(x['pass'] is not True for x in rows): uncovered.add(r)
        o.append(f"{r}: {', '.join(parts)}: {', '.join(ids)}")
    o.append('')
o.append(f"requirements with zero checks or any failing check: {sorted(uncovered)}")
open(f'{E}/04-requirement-trace.txt','w').write('\n'.join(o)+'\n'); print(o[-1])
