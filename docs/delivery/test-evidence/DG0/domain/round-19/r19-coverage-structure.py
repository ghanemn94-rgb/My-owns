#!/usr/bin/env python3
"""Round-19 structural coverage check. Usage: r19-coverage-structure.py <clone>"""
import sys,csv,json,re,collections
R=sys.argv[1]
bl=json.load(open(f'{R}/docs/source/playbook.blocks.json')); ids=[b['id'] for b in bl]
sc=list(csv.DictReader(open(f'{R}/docs/analysis/source-coverage.csv',encoding='utf8')))
rq={r['req_id']:r for r in csv.DictReader(open(f'{R}/docs/delivery/requirements.csv',encoding='utf8'))}
mb=json.load(open(f'{R}/docs/source/master-prompt.blocks.json')); mids=[b['id'] for b in mb]
mc=list(csv.DictReader(open(f'{R}/docs/analysis/master-prompt-coverage.csv',encoding='utf8')))
err=[]
print('blocks',len(ids),ids[0],ids[-1],'coverage rows',len(sc))
if [r['block_id'] for r in sc]!=ids: err.append('source-coverage block list != blocks.json')
print('dispositions',collections.Counter(r['disposition'] for r in sc))
cited=collections.defaultdict(set)
for k,r in rq.items():
    for s in re.split(r'[;, ]+',r['source_ref']):
        if s: cited[s].add(k)
for r in sc:
    reqs=[x for x in re.split(r'[;, ]+',r['req_ids']) if x]
    if r['disposition']=='REQUIREMENT' and not reqs: err.append(f"{r['block_id']} REQUIREMENT without req")
    for q in reqs:
        if q not in rq: err.append(f"{r['block_id']} -> unknown {q}")
        elif r['block_id'] not in rq[q]['source_ref']: err.append(f"{r['block_id']} -> {q} but {q}.source_ref lacks the block")
    if not r['rationale'].strip() and r['disposition']!='REQUIREMENT': err.append(f"{r['block_id']} no rationale")
# reverse: every block cited by a req's source_ref lists that req in coverage? (soft)
covmap={r['block_id']:set(x for x in re.split(r'[;, ]+',r['req_ids']) if x) for r in sc}
soft=[f'{b}:{q}' for b,qs in cited.items() if b.startswith('B') for q in qs if q not in covmap.get(b,set())]
print('soft: req cites block but coverage row does not list req:',len(soft),soft[:15])
# SOURCE rows must cite at least one B block
for k,r in rq.items():
    if r['class']=='SOURCE' and not re.search(r'B\d{4}',r['source_ref']): err.append(f'{k} SOURCE without B-block')
    if r['class'] in('USER','ENGINEERING') and re.search(r'B\d{4}',r['source_ref']) and not re.search(r'M\d{4}',r['source_ref']): err.append(f'{k} {r["class"]} cites only B blocks')
print('classes',collections.Counter(r['class'] for r in rq.values()))
print('prefix x class',collections.Counter((k.split('-')[1],r['class']) for k,r in rq.items()))
print('mp blocks',len(mids),'mp coverage rows',len(mc), 'match' if [r['block_id'] for r in mc]==mids else 'MISMATCH')
print('mp dispositions',collections.Counter(r['disposition'] for r in mc))
for r in mc:
    for q in [x for x in re.split(r'[;, ]+',r['req_ids']) if x]:
        if q not in rq: err.append(f"{r['block_id']} -> unknown {q}")
        elif r['block_id'] not in rq[q]['source_ref']: err.append(f"{r['block_id']} -> {q} but source_ref lacks it")
    if r['disposition']=='REQUIREMENT' and not r['req_ids'].strip(): err.append(f"{r['block_id']} REQUIREMENT without req")
print('errors',len(err)); [print(' ',e) for e in err[:50]]
sys.exit(1 if err else 0)
