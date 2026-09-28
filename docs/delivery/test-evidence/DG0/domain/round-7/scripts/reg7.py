import csv,re,collections,json,sys
reg={r['req_id']:r for r in csv.DictReader(open('docs/delivery/requirements.csv',encoding='utf8'))}
def refs(s):
  out=set()
  for tok in re.split(r'[;,\s]+',s):
    m=re.match(r'^([BM])(\d{4})(?:[-–]([BM])?(\d{4}))?$',tok)
    if m:
      a=int(m.group(2)); b=int(m.group(4) or a)
      out|={f'{m.group(1)}{i:04d}' for i in range(a,b+1)}
  return out
srefs={k:refs(v['source_ref']) for k,v in reg.items()}
for f,pre,n in [('docs/analysis/source-coverage.csv','B',165),('docs/analysis/master-prompt-coverage.csv','M',423)]:
  rows=list(csv.DictReader(open(f,encoding='utf8')))
  ids=[r['block_id'] for r in rows]
  exp=[f'{pre}{i:04d}' for i in range(1,n+1)]
  prob=[]
  if ids!=exp: prob.append('block list mismatch')
  for r in rows:
    rq=[x for x in r['req_ids'].split(';') if x]
    if r['disposition']=='REQUIREMENT' and not rq: prob.append(r['block_id']+' REQUIREMENT without reqs')
    if not r['rationale'].strip(): prob.append(r['block_id']+' no rationale')
    for q in rq:
      if q not in reg: prob.append(f"{r['block_id']} unknown {q}")
      elif r['block_id'] not in srefs[q]: prob.append(f"{r['block_id']} {q} no back-ref")
  print(f,len(rows),collections.Counter(r['disposition'] for r in rows),'problems',prob[:20],len(prob))
print('classes',collections.Counter(r['class'] for r in reg.values()))
print('SOURCE rows without B anchor',[k for k,v in reg.items() if v['class']=='SOURCE' and not any(x.startswith('B') for x in srefs[k])])
print('non-SOURCE rows without M anchor',[k for k,v in reg.items() if v['class']!='SOURCE' and not any(x.startswith('M') for x in srefs[k])])
print('REQ-PB not SOURCE',[k for k,v in reg.items() if k.startswith('REQ-PB') and v['class']!='SOURCE'])
print('empty acceptance',[k for k,v in reg.items() if not v['acceptance'].strip()])
# B blocks referenced by reqs but not in coverage mapping (reverse)
cov={r['block_id']:r for r in csv.DictReader(open('docs/analysis/source-coverage.csv',encoding='utf8'))}
rev=[(k,b) for k,s in srefs.items() for b in s if b.startswith('B') and k not in cov[b]['req_ids'].split(';')]
print('reverse B refs not listed in coverage',len(rev),rev[:10])
