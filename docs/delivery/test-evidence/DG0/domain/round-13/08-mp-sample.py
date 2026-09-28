# Master-prompt coverage sample: 3 random blocks per section (seed 13) + 8 random table rows.
# Prints block text, disposition, mapped requirements, and whether each mapped row cites the block.
import csv,re,random,collections
lines=open('docs/source/master-prompt.anchored.md',encoding='utf-8').read().split('\n')
blocks={}; cur=None
for l in lines:
    m=re.match(r'^(?:## )?\[(M\d{4}) (§[^\]]+)\] ?(.*)',l)
    if m: cur=m.group(1); blocks[cur]=[m.group(2),m.group(3)]
    elif cur and l.strip(): blocks[cur][1]+=' '+l.strip()
cov={r['block_id']:r for r in csv.DictReader(open('docs/analysis/master-prompt-coverage.csv'))}
reg={r['req_id']:r for r in csv.DictReader(open('docs/delivery/requirements.csv'))}
print('blocks',len(blocks),'coverage rows',len(cov),'uncovered',sorted(set(blocks)-set(cov)),'extra',sorted(set(cov)-set(blocks)))
print('dispositions',collections.Counter(c['disposition'] for c in cov.values()))
bad=[b for b,c in cov.items() if c['disposition']=='REQUIREMENT' and not c['req_ids']]
dangling=[(b,r) for b,c in cov.items() for r in c['req_ids'].split(';') if r and r not in reg]
print('REQUIREMENT without req_ids',bad,'dangling ids',dangling)
bysec=collections.defaultdict(list)
for b,(s,t) in sorted(blocks.items()): bysec[s.split('.')[0]].append(b)
random.seed(13); sample=[]
for s in bysec: sample+=random.sample(bysec[s],min(3,len(bysec[s])))
tables=[b for b,(s,t) in blocks.items() if t.startswith('|') and not set(t)<=set('|- ')]
sample+=random.sample(tables,8); sample=sorted(set(sample))
print('SECTIONS',sorted(bysec)); print('SAMPLE',len(sample),';'.join(sample))
for b in sample:
    s,t=blocks[b]; c=cov[b]
    print('\n=====',b,s,c['disposition'],c['req_ids']); print('TEXT:',re.sub(r'\s+',' ',t)[:500]); print('RATIONALE:',c['rationale'][:200])
    for rid in [x for x in c['req_ids'].split(';') if x][:4]:
        r=reg.get(rid); print('  ->',rid,(r['class']+' '+r['final_gate']+' | '+r['title'][:130]) if r else 'MISSING', '| cites' if r and b in r['source_ref'] else '| DOES NOT CITE')
