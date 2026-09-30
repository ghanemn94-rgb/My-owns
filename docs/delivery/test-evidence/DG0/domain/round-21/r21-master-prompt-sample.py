import csv,re,random,collections
txt=open('docs/source/master-prompt.anchored.md',encoding='utf-8').read()
blocks=collections.OrderedDict()
for m in re.finditer(r'(?:^|\n)(?:#+ )?\[(M\d{4}) §([^\]]+)\] ?(.*?)(?=\n(?:#+ )?\[M\d{4} |\Z)',txt,re.S):
    blocks[m.group(1)]=(m.group(2),m.group(3).strip())
cov={r['block_id']:r for r in csv.DictReader(open('docs/analysis/master-prompt-coverage.csv',encoding='utf-8'))}
reg={r['req_id']:r for r in csv.DictReader(open('docs/delivery/requirements.csv',encoding='utf-8'))}
print('parsed blocks',len(blocks),'coverage',len(cov),'same ids',list(blocks)==list(cov))
# structural: every REQUIREMENT M block's reqs exist and cite it
bad=[]
for b,c in cov.items():
    ids=[x for x in re.split(r'[;, ]+',c['req_ids']) if x]
    if c['disposition']=='REQUIREMENT' and not ids: bad.append((b,'noreq'))
    for i in ids:
        if i not in reg: bad.append((b,'unknown',i))
        elif b not in reg[i]['source_ref']: bad.append((b,'notcited',i))
print('structural problems',bad[:20],len(bad))
sec=collections.defaultdict(list)
for b,(s,t) in blocks.items():
    top=s.split('.')[0] if s!='preamble' else 'preamble'
    if top.startswith('0') and s!='0' : top='0'
    sec[top].append(b)
rnd=random.Random(21); sample=[]
for s,ids in sec.items():
    k=max(3,round(len(ids)*0.16)); k=min(k,len(ids))
    sample+=rnd.sample(ids,k)
# ensure table rows: blocks whose text starts with '|' or contains ' | '
tables=[b for b,(s,t) in blocks.items() if t.startswith('|') or 'row' in s.lower()]
print('sections',{s:len(v) for s,v in sec.items()}); print('table-like blocks',len(tables))
extra=[b for b in rnd.sample(tables,min(6,len(tables))) if b not in sample]; sample+=extra
sample=sorted(set(sample))
print('SAMPLE',len(sample),' '.join(sample))
for b in sample:
    s,t=blocks[b]; c=cov[b]
    print(f'\n### {b} §{s} [{c["disposition"]}] {c["req_ids"]}\n  TEXT: {t[:600]}')
    if c['disposition']!='REQUIREMENT': print('  RATIONALE:',c['rationale'])
    for i in [x for x in re.split(r'[;, ]+',c['req_ids']) if x]:
        r=reg[i]; print(f'  -> {i} [{r["class"]}] {r["title"][:200]} | final {r["final_gate"]}')
