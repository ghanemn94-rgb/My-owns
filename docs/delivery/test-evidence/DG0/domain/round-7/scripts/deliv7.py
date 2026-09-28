import json,re,csv
b=json.load(open('docs/source/playbook.blocks.json')); b=b['blocks'] if isinstance(b,dict) else b
bl={x['id']:x for x in b}
reg=list(csv.DictReader(open('docs/delivery/requirements.csv',encoding='utf8')))
fi=open('docs/analysis/field-inventory.md',encoding='utf8').read()
def n(s):
  s=s.replace('☐',' ').replace('’',"'").replace('“','"').replace('”','"')
  return re.sub(r'\s+',' ',re.sub(r'<br\s*/?>',' ',s)).strip().lower()
FI=n(fi)
def regtext(blk): return n(' '.join(' '.join(r.values()) for r in reg if re.search(r'\b'+blk+r'\b',r['source_ref']) or any(blk==x for x in expand(r['source_ref']))))
def expand(s):
  out=[]
  for tok in re.split(r'[;,\s]+',s):
    m=re.match(r'^B(\d{4})(?:[-–]B?(\d{4}))?$',tok)
    if m:
      a=int(m.group(1)); z=int(m.group(2) or a); out+= [f'B{i:04d}' for i in range(a,z+1)]
  return out
RALL=n(' '.join(' '.join(r.values()) for r in reg))
def chk(name,blk,items):
  rt=regtext(blk)
  miss_fi=[i for i in items if n(i) not in FI]
  miss_rg=[i for i in items if n(i) not in rt]
  miss_all=[i for i in items if n(i) not in RALL and n(i) not in FI]
  print(f'{name} [{blk}] items={len(items)} missing-in-FI={miss_fi} missing-in-citing-reg-rows={len(miss_rg)} missing-everywhere={miss_all}')
rows=lambda k: bl[k]['rows']
chk('Charter fields','B0035',[r[0] for r in rows('B0035')[1:]]); print('   charter count',len(rows('B0035'))-1)
chk('Thesis','B0037',[re.sub(r'^.*?Complete this sentence\s*','',rows('B0037')[0][0])[:80]])
chk('Scope checks','B0039',[bl[f'B{i:04d}']['text'] for i in range(39,44)])
chk('Outcome hierarchy','B0048',[r[0] for r in rows('B0048')[1:]]+[r[1] for r in rows('B0048')[1:]])
chk('TOM dims','B0056',[re.sub(r'^\d+\.\s*','',r[0]) for r in rows('B0056')[1:]]+[r[1] for r in rows('B0056')[1:]]); print('   TOM count',len(rows('B0056'))-1)
canv=[c for r in rows('B0062') for c in r]
prompts=[]
for c in canv:
  ls=[l for l in c.split('\n') if l.strip()]
  prompts+= ls[:2]
chk('Canvas titles+prompts','B0062',prompts); print('   canvas cells',len(canv))
chk('Workshop','B0063',['90-120 minute'])
chk('Business case sections','B0085',[r[0] for r in rows('B0085')[1:]]+[r[1] for r in rows('B0085')[1:]]); print('   BC count',len(rows('B0085'))-1)
chk('Lifecycle','B0121',[c for r in rows('B0121')[1:] for c in r])
chk('Adoption indicators','B0109',[bl[f'B{i:04d}']['text'] for i in range(109,116)])
chk('90-day plan','B0134',[c for r in rows('B0134')[1:] for c in r])
chk('Day-90 test','B0136',[bl[f'B{i:04d}']['text'] for i in range(136,142)])
qs=[re.sub(r'^\s*☐?\s*\d+\.\s*','',c).strip() for r in rows('B0150') for c in r if c.strip()]
chk('Health check questions','B0150',qs); print('   HC count',len(qs))
chk('Health bands','B0152',[c for r in rows('B0152')[1:] for c in r])
chk('Roaming example','B0145',[c for r in rows('B0145')[1:] for c in r])
chk('Roaming traceability','B0147',[c for r in rows('B0147')[1:] for c in r])
chk('Modes','B0009',[c for r in rows('B0009')[1:] for c in r])
chk('Phases','B0021',[c for r in rows('B0021') for c in r[1:]])
chk('Gates','B0023',[c for r in rows('B0023')[1:] for c in r])
chk('Governance roles','B0018',[c for r in rows('B0018')[1:] for c in r])
chk('Principles','B0011',[bl[f'B{i:04d}']['text'] for i in range(11,16)])
chk('Workstreams','B0029',[c for r in rows('B0029')[1:] for c in r])
chk('Traceability chain','B0070',[rows('B0070')[0][0]])
