import csv,json,re,collections
blocks=json.load(open('docs/source/playbook.blocks.json'))
bids=[b['id'] for b in blocks]
cov=list(csv.DictReader(open('docs/analysis/source-coverage.csv',encoding='utf-8')))
reg={r['req_id']:r for r in csv.DictReader(open('docs/delivery/requirements.csv',encoding='utf-8'))}
print('blocks',len(bids),bids[0],bids[-1],'coverage rows',len(cov))
print('coverage ids == blocks ids:',[c['block_id'] for c in cov]==bids)
print('dispositions',collections.Counter(c['disposition'] for c in cov))
bad=[]
for c in cov:
    ids=[x for x in re.split(r'[;, ]+',c['req_ids']) if x]
    if c['disposition']=='REQUIREMENT':
        if not ids: bad.append((c['block_id'],'no req'))
        for i in ids:
            if i not in reg: bad.append((c['block_id'],'unknown',i))
            elif c['block_id'] not in reg[i]['source_ref']: bad.append((c['block_id'],'req does not cite block',i))
    if not c['rationale'].strip() and c['disposition']!='REQUIREMENT': bad.append((c['block_id'],'no rationale'))
print('problems',bad)
pb=[r for r in reg.values() if r['req_id'].startswith('REQ-PB-')]
print('REQ-PB rows',len(pb),'classes',collections.Counter(r['class'] for r in pb))
# every B-block cited by a REQ-PB row should be REQUIREMENT or at least mapped
covd={c['block_id']:c for c in cov}
back=[]
for r in pb:
    for b in re.findall(r'B\d{4}',r['source_ref']):
        if b not in covd: back.append((r['req_id'],b,'unknown block'))
        elif r['req_id'] not in covd[b]['req_ids']: back.append((r['req_id'],b,covd[b]['disposition']))
print('REQ-PB cites block but block does not list req (informational):',len(back)); print(back[:40])
print('status of REQ-PB:',collections.Counter(r['status'] for r in pb))
print('SOURCE rows without any B ref:',[r['req_id'] for r in reg.values() if r['class']=='SOURCE' and not re.search(r'B\d{4}',r['source_ref'])])
print('all classes',collections.Counter(r['class'] for r in reg.values()))
