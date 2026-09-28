import csv,re,random,sys
cov={r['block_id']:r for r in csv.DictReader(open('docs/analysis/master-prompt-coverage.csv',encoding='utf-8'))}
reg={r['req_id']:r for r in csv.DictReader(open('docs/delivery/requirements.csv',encoding='utf-8'))}
mp={};secof={}
for l in open('docs/source/master-prompt.anchored.md',encoding='utf-8'):
    m=re.match(r'\[(M\d{4}) §([\d.]+|pre\w*|-)\]\s*(.*)',l)
    if m: mp[m.group(1)]=m.group(3);secof[m.group(1)]=m.group(2)
from collections import defaultdict
bys=defaultdict(list)
for k in sorted(mp): bys[secof[k]].append(k)
random.seed(20260930)
sample=[]
for s,ks in bys.items():
    n=max(2,round(len(ks)*0.16)); sample+=random.sample(ks,min(n,len(ks)))
sample.sort()
if sys.argv[1]=='list': print(len(sample),'sections',len(bys),dict((s,len(v)) for s,v in bys.items())); print(' '.join(sample))
else:
    a,b=int(sys.argv[2]),int(sys.argv[3])
    for k in sample[a:b]:
        c=cov[k]; print(f"## {k} §{secof[k]} [{c['disposition']}] {mp[k][:330]}")
        if c['rationale']: print('   rationale:',c['rationale'][:200])
        for i in [x for x in c['req_ids'].split(';') if x]:
            r=reg.get(i); print('   ->',i, (r['title'][:150]+' | '+r['final_gate']+' | refs '+str(k in r['source_ref'])) if r else 'MISSING')
