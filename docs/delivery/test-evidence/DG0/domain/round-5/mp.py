import csv,re,collections,random
cov={x['block_id']:x for x in csv.DictReader(open('docs/analysis/master-prompt-coverage.csv',encoding='utf8'))}
reg={x['req_id']:x for x in csv.DictReader(open('docs/delivery/requirements.csv',encoding='utf8'))}
blocks={}
for line in open('docs/source/master-prompt.anchored.md',encoding='utf8'):
  m=re.match(r'^(?:#+\s*)?\[(M\d{4}) (§[\w.]+)\]\s*(.*)',line)
  if m: blocks[m.group(1)]=(m.group(2).split('.')[0],m.group(3).strip())
bysec=collections.defaultdict(list)
for k,(s,t) in blocks.items(): bysec[s].append(k)
random.seed(5)
sample=[]
for s,ks in bysec.items():
  n=max(2,round(len(ks)*0.16))
  sample+=random.sample(ks,min(n,len(ks)))
# ensure table rows sampled
tbl=[k for k,(s,t) in blocks.items() if t.startswith('|')]
sample+= [k for k in random.sample(tbl,6) if k not in sample]
sample=sorted(set(sample))
print('sample size',len(sample),'sections',sorted({blocks[k][0] for k in sample},key=lambda s:(len(s),s)))
for k in sample:
  s,t=blocks[k]; c=cov[k]
  print(f"\n{k} {s} [{c['disposition']}] {t[:260]}")
  print('   ->',c['req_ids'] or '-', '|', c['rationale'][:120])
  for r in filter(None,c['req_ids'].split(';'))[:3] if False else list(filter(None,c['req_ids'].split(';')))[:3]:
    print('     ',r,reg[r]['class'],reg[r]['final_gate'],':',reg[r]['title'][:150])
