# Round-15 domain check: operating-logic semantics, provenance honesty, glossary/journeys/permissions, class labelling.
# Each probe is (label, file-or-register-row, list of regexes that must all match). Prints the matching row text for manual reading.
import csv, re, sys
reg = {r['req_id']: r for r in csv.DictReader(open('docs/delivery/requirements.csv', encoding='utf-8'))}
def row(k): r = reg[k]; return ' '.join(r.values())
def rd(p): return open(p, encoding='utf-8').read()
bad = 0
def probe(label, text, pats, show=''):
    global bad
    miss = [p for p in pats if not re.search(p, text, re.I | re.S)]
    print(('OK   ' if not miss else 'FAIL ') + label + ('' if not miss else '  missing=' + str(miss)))
    if show: print('     ' + show[:300])
    bad += bool(miss)
S = [
 ('RAG from trajectory, not task completion', 'REQ-S07-007', [r'trajectory', r'never from .*task completion', r'all tasks complete.*Red']),
 ('T10 RAG per area; Unknown on missing', 'REQ-PB-063', [r'target trajectory, not activity completion', r'validated benefit gap', r'Unknown']),
 ('Four separate statuses', 'REQ-S03-003', [r'delivery', r'adoption', r'validated value', r'closure', r'separate', r'unchanged']),
 ('Forecast never validated', 'REQ-S08-001', [r'forecast', r'never appears in the validated total']),
 ('Finance validates, owner accountable', 'REQ-PB-080', [r'Finance', r'(Business Owner|owner)']),
 ('Gates explicit approvals with evidence snapshot', 'REQ-S04-010', [r'snapshot']),
]
for label, k, pats in S: probe(label + ' ' + k, row(k), pats, reg[k]['title'])
# search whole register for count-once / allocation <=100% / unallocated shown
allrows = '\n'.join(row(k) for k in reg)
for label, pats in [('shared benefit counted once', [r'count(ed)? once|double.count']), ('allocation <=100% with unallocated shown', [r'(≤|<=) ?100 ?%|exceed 100', r'unallocated']),
                    ('Finance validation separate from owner accountability', [r'Finance validat', r'Business Owner.{0,80}accountab|accountab.{0,80}Business Owner']),
                    ('G6 never implies DG7', [r'G6.{0,80}never.{0,40}DG7|DG7.{0,80}G1.G6']),
                    ('technical admin not business approver', [r'[Tt]echnical admin\w* (are|is) not (a )?business approver'])]:
    hits = [k for k in reg if all(re.search(p, row(k), re.I) for p in pats)]
    print(('OK   ' if hits else 'FAIL ') + label + ' rows=' + ','.join(hits[:8])); bad += not hits
# provenance honesty
for label, k, pats in [('PB-001 synthesis inspired by PMI/Brightline/BRM', 'REQ-PB-001', [r'inspired', r'PMI', r'Brightline', r'BRM', r'(never|not).{0,60}official']),
                       ('PB-002', 'REQ-PB-002', [r'.'])]:
    probe(label, row(k), pats, reg[k]['title'] + ' | ' + reg[k]['acceptance'])
brand = [k for k in reg if '0078FF' in row(k).upper()]
print('rows mentioning #0078FF:', brand)
for k in brand: print('   ', k, 'provisional' in row(k).lower())
bad += any('provisional' not in row(k).lower() for k in brand)
# claims of official status anywhere in analysis docs
import glob
for p in glob.glob('docs/analysis/*.md') + ['docs/delivery/requirements-spec.md']:
    for i, l in enumerate(rd(p).splitlines(), 1):
        if re.search(r'official (PMI|Mobily)|PMI[- ]certified|certified by PMI|PMI standard', l, re.I) and not re.search(r'\b(not|never|no|without|nor)\b', l, re.I):
            print('SUSPECT CLAIM', p, i, l[:200]); bad += 1
# class labelling: SOURCE rows whose notes say master-prompt additions but carry no 'Master-prompt additions' label
src = [r for r in reg.values() if r['class'] == 'SOURCE']
nolabel = [r['req_id'] for r in src if 'Playbook' not in r['notes'] or 'Master-prompt additions' not in r['notes'] or 'Interpretations' not in r['notes']]
print('SOURCE rows', len(src), 'missing provenance labels (Playbook/Master-prompt additions/Interpretations):', nolabel); bad += len(nolabel)
hc = [k for k in reg if re.search(r'health.check', reg[k]['title'], re.I)]
for k in hc: print('health-check row', k, reg[k]['class'], '| interp:', re.search(r'Interpretations:(.*)', reg[k]['notes']).group(1)[:220] if 'Interpretations:' in reg[k]['notes'] else '-')
# glossary Arabic terms, journeys, permissions
g = rd('docs/analysis/glossary.md'); j = rd('docs/analysis/user-journeys.md'); pm = rd('docs/analysis/permissions-matrix.md')
arabic_rows = [l for l in g.splitlines() if re.search(r'[؀-ۿ]', l)]
print('glossary rows with Arabic:', len(arabic_rows))
for l in arabic_rows: print('   ', l[:170])
for label, pats in [('journeys: all six phases + G1..G6', [r'Diagnose.{0,20}G1', r'Define.{0,20}G2', r'Design.{0,20}G3', r'Mobilize.{0,20}G4', r'Transform.{0,20}G5', r'Realize.{0,20}G6']),
                    ('journeys: modular entry', [r'[Mm]odular']), ('journeys: KPI update', [r'KPI (actual|update)|actuals?']),
                    ('journeys: Finance validation', [r'Finance valid']), ('journeys: committee workflow', [r'[Cc]ommittee']),
                    ('journeys: BAU handover', [r'BAU']), ('journeys: admin publishing', [r'[Pp]ublish'])]:
    probe(label, j, pats)
for label, pats in [('permissions: T11 SLAs', [r'5 working days', r'10 working days']), ('permissions: RACI roles', [r'Sponsor', r'Transformation Lead|TMO', r'Finance', r'Business Owner|Initiative owner']),
                    ('permissions: tech admins not approvers', [r'[Tt]echnical administrators are not business approvers']), ('permissions: automation never approves', [r'[Aa]utomation never approves'])]:
    probe(label, pm, pats)
print('problems', bad); sys.exit(1 if bad else 0)
