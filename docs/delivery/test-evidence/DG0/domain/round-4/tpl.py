import csv,json,re
bl=json.load(open('docs/source/playbook.blocks.json'))
reg=list(csv.DictReader(open('docs/delivery/requirements.csv',encoding='utf-8')))
fi=open('docs/analysis/field-inventory.md',encoding='utf-8').read()
tot=0
for i,b in enumerate(bl):
    m=re.match(r'Template (\d+) — (.*)',b.get('text','') if b['type']!='table' else '')
    if not m: continue
    tid='T%02d'%int(m.group(1))
    t=next(x for x in bl[i+1:] if x['type']=='table')
    hdr=[c.replace('\n',' ').strip() for c in t['rows'][0]]
    rows=[r for r in reg if r['template_id']==tid]
    blob=' '.join(r['input_fields']+' '+r['acceptance'] for r in rows)
    mf=[c for c in hdr if c not in fi]
    mr=[c for c in hdr if c not in blob]
    tot+=len(mf)+len(mr)
    print(tid,m.group(2),t['id'],'hdr=',hdr,'\n   reg',[r['req_id'] for r in rows],'missFI',mf,'missREG',mr)
    for r in t['rows'][1:]: print('     row:',r)
print('TOTAL missing',tot)
