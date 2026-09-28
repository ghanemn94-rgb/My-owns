# domain-reviewer round-12 checks (run from the root of a clone of the candidate commit)
import json, csv, re, random, collections
b = {x['id']: x for x in json.load(open('docs/source/playbook.blocks.json'))}
reg = {x['req_id']: x for x in csv.DictReader(open('docs/delivery/requirements.csv'))}
fi = open('docs/analysis/field-inventory.md').read()
both = fi + open('docs/delivery/requirements.csv').read()
fails = 0

print('## 1 template headers verbatim in register row and field inventory')
m = {'T01': ('B0031', 'REQ-PB-026'), 'T02': ('B0050', 'REQ-PB-034'), 'T03': ('B0058', 'REQ-PB-039'), 'T04': ('B0065', 'REQ-PB-043'),
     'T05': ('B0072', 'REQ-PB-045'), 'T06': ('B0076', 'REQ-PB-047'), 'T07': ('B0079', 'REQ-PB-050'), 'T08': ('B0081', 'REQ-PB-051'),
     'T09': ('B0087', 'REQ-PB-056'), 'T10': ('B0095', 'REQ-PB-062'), 'T11': ('B0099', 'REQ-PB-065'), 'T12': ('B0101', 'REQ-PB-067'),
     'T13': ('B0107', 'REQ-PB-070'), 'T14': ('B0123', 'REQ-PB-075'), 'T15': ('B0128', 'REQ-PB-079'), 'T16': ('B0130', 'REQ-PB-081')}
for t, (bid, rid) in m.items():
    rows = b[bid]['rows']
    cols = [r[0] for r in rows[1:]] if t == 'T05' else rows[0]
    missR = [h for h in cols if h not in reg[rid]['input_fields']]
    missF = [h for h in cols if h not in fi]
    fails += bool(missR or missF)
    print(t, rid, len(cols), 'cols; missing reg', missR, 'missing FI', missF)
cf = [r[0] for r in b['B0035']['rows'][1:]]
miss = [c for c in cf if c not in reg['REQ-PB-029']['input_fields']]
fails += bool(miss)
print('Charter fields', len(cf), 'missing', miss)

print('## 2 enumerated source content verbatim (FI or register)')
def chk(label, items):
    global fails
    miss = [i for i in items if i not in both]
    fails += bool(miss)
    print(label, len(items), 'missing', miss)
chk('health-check questions', [re.sub(r'^☐ \d+\. ', '', c) for r in b['B0150']['rows'] for c in r if c.startswith('☐')])
for label, bid in [('bands', 'B0152'), ('90-day', 'B0134'), ('roaming', 'B0145'), ('traceability', 'B0147'), ('lifecycle', 'B0121'),
                   ('OS layers', 'B0093'), ('roles', 'B0018'), ('gates', 'B0023'), ('TOM dims', 'B0056'), ('business case', 'B0085'),
                   ('modes', 'B0009'), ('phases', 'B0021'), ('waves', 'B0079'), ('T11', 'B0099'), ('T10', 'B0095')]:
    chk(label, [c for r in b[bid]['rows'][(0 if bid == 'B0021' else 1):] for c in r])
chk('adoption indicators', [b['B%04d' % i]['text'] for i in range(109, 116)])
chk('scope sanity checks', [b['B%04d' % i]['text'] for i in range(39, 44)])
chk('day-90 test', [b['B%04d' % i]['text'] for i in range(136, 142)])

print('## 3 coverage integrity')
for f, pre in [('docs/analysis/source-coverage.csv', 'B'), ('docs/analysis/master-prompt-coverage.csv', 'M')]:
    c = list(csv.DictReader(open(f)))
    dang = [(x['block_id'], q) for x in c for q in x['req_ids'].split(';') if q.strip() and q.strip() not in reg]
    noids = [x['block_id'] for x in c if x['disposition'] == 'REQUIREMENT' and not x['req_ids'].strip()]
    fails += bool(dang or noids)
    print(f, len(c), collections.Counter(x['disposition'] for x in c), 'dangling', dang, 'REQ-without-ids', noids)
print('SOURCE rows without B ref', [r['req_id'] for r in reg.values() if r['class'] == 'SOURCE' and not any(s.strip().startswith('B') for s in r['source_ref'].split(';'))])
print('non-SOURCE rows with B ref', [r['req_id'] for r in reg.values() if r['class'] != 'SOURCE' and any(s.strip().startswith('B') for s in r['source_ref'].split(';'))])

print('## 4 staging of template rows')
for t, (bid, rid) in m.items():
    print(t, reg[rid]['final_gate'], end='; ')
print()
for g in range(16, 22):
    rid = 'REQ-PB-%03d' % g
    print(rid, reg[rid]['final_gate'], end='; ')
print()

print('## 5 master-prompt stratified sample (seed 12, up to 3 blocks per section)')
blocks = {}
for l in open('docs/source/master-prompt.anchored.md', encoding='utf8'):
    mm = re.match(r'\[(M\d{4}) (§[^\]]+)\]', l)
    if mm: blocks[mm.group(1)] = mm.group(2)
bysec = collections.defaultdict(list)
for k, s in blocks.items(): bysec[s].append(k)
random.seed(12)
sample = []
for s, v in bysec.items(): sample += random.sample(v, min(3, len(v)))
print(len(sample), 'blocks:', ' '.join(sorted(sample)))
print('RESULT', 'PASS' if fails == 0 else 'FAIL (%d)' % fails)
