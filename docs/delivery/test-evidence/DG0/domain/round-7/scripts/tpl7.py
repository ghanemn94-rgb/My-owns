import json,re,csv
bl={x['id']:x for x in (lambda b: b['blocks'] if isinstance(b,dict) else b)(json.load(open('docs/source/playbook.blocks.json')))}
fi=open('docs/analysis/field-inventory.md',encoding='utf8').read()
reg=list(csv.DictReader(open('docs/delivery/requirements.csv',encoding='utf8')))
secs=re.split(r'\n(?=## )',fi)
tot=0;bad=0
def n(s): return re.sub(r'\s+',' ',s.replace('\n',' ')).strip()
for s in secs:
  m=re.match(r'## (T\d\d) — (.*?) \(([^)]*)\) → (.*)',s)
  if not m: continue
  t,name,blks,reqs=m.groups()
  fields=[n(r.split('|')[2]) for r in s.split('\n') if re.match(r'\| *\d+ *\|',r)]
  hdrs=[]
  for b in re.findall(r'B\d{4}',blks):
    x=bl[b]
    if x['type']=='table': hdrs+= [n(c) for c in x['rows'][0]]
  regrows=[r for r in reg if t in r['template_id'].split(';') or re.search(r'\b'+t+r'\b',r['template_id'])]
  regtxt=' '.join(n(r['input_fields']) for r in regrows)
  missfi=[h for h in hdrs if h not in fields and h]
  missreg=[h for h in hdrs if h and h not in regtxt]
  tot+=1
  ok= not missfi and not missreg
  if not ok: bad+=1
  print(t,name,'| src cols',len(hdrs),'| FI fields',len(fields),'| reg rows',[r['req_id'] for r in regrows],'| missing in FI',missfi,'| missing in reg',missreg)
print('templates',tot,'with gaps',bad)
