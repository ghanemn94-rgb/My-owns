import csv,json,re,glob
bl={b['id']:b for b in json.load(open('docs/source/playbook.blocks.json'))}
reg=open('docs/delivery/requirements.csv').read()
fi=open('docs/analysis/field-inventory.md').read()
def n(s): return re.sub(r'\s+',' ',s.replace('’',"'").replace('“','"').replace('”','"').replace('—','-').replace('–','-').replace('×','x').replace('→','->')).strip().lower()
R=n(reg);F=n(fi)
tables={'B0009':'modes','B0018':'min gov roles','B0021':'6 phases','B0023':'G1-G6','B0035':'charter','B0048':'outcome hierarchy','B0056':'10 TOM dims','B0062':'TOM canvas','B0079':'waves T07','B0085':'business case','B0093':'OS layers','B0095':'T10 RAG','B0099':'T11','B0101':'T12 RACI','B0121':'benefits lifecycle','B0134':'90-day plan','B0145':'roaming','B0147':'roaming traceability','B0152':'bands','B0076':'T06','B0128':'T15','B0107':'T13','B0081':'T08','B0031':'T01','B0072':'T05'}
lists={'principles':['B0011','B0012','B0013','B0014','B0015'],'scope checks':['B0039','B0040','B0041','B0042','B0043'],'adoption indicators':['B0109','B0110','B0111','B0112','B0113','B0114','B0115'],'day90':['B0136','B0137','B0138','B0139','B0140','B0141'],'thesis':['B0037'],'workshop':['B0063'],'custom':['B0158','B0159','B0160','B0161','B0162'],'provenance':['B0004'],'illustrative':['B0144'],'weights adj':['B0077'],'bc':['B0084'],'adoption':['B0105']}
tot=0
for b,name in tables.items():
  cells=[p for r in bl[b]['rows'] for c in r for p in re.split(r'\n+',c) if p.strip()]
  mR=[c for c in cells if n(c) not in R]; mB=[c for c in cells if n(c) not in R and n(c) not in F]
  tot+=len(mB); print(f'{b} {name}: cells {len(cells)} notInRegister {len(mR)} notInRegOrFI {len(mB)}',mB[:8])
for name,bs in lists.items():
  for b in bs:
    t=bl[b]['text'] if bl[b]['type']!='table' else bl[b]['rows'][0][0]
    t=re.sub(r'^(Complete this sentence)\s+','',t)
    ok=n(t) in R or n(t) in F
    if not ok: tot+=1
    print(f'  {name} {b} verbatim={ok}' + ('' if ok else ' :: '+t[:160]))
print('TOTAL NOT VERBATIM',tot)
