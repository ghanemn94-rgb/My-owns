import csv,json,re
bl={x['id']:x for x in json.load(open('docs/source/playbook.blocks.json'))}
reg={x['req_id']:x for x in csv.DictReader(open('docs/delivery/requirements.csv',encoding='utf8'))}
fi=open('docs/analysis/field-inventory.md',encoding='utf8').read()
T={'T01':'B0031','T02':'B0050','T03':'B0058','T04':'B0065','T05':'B0072','T06':'B0076','T07':'B0079','T08':'B0081','T09':'B0087','T10':'B0095','T11':'B0099','T12':'B0101','T13':'B0107','T14':'B0123','T15':'B0128','T16':'B0130'}
bad=0
for t,b in T.items():
  rows=bl[b]['rows']; hdr=[c.strip() for c in rows[0]]
  sec=fi.split('## '+t+' ')[1].split('\n## ')[0]
  regrows=[r for r in reg.values() if t in r['template_id'].split(';')]
  regtxt=' '.join(r['input_fields'] for r in regrows)
  miss_fi=[h for h in hdr if h not in sec]
  miss_reg=[h for h in hdr if h not in regtxt]
  # also body values
  vals=set()
  for r in rows[1:]:
    for c in r: 
      c=c.strip()
      if c and len(c)<40: vals.add(c)
  mv=[v for v in vals if v not in sec]
  print(t,b,'cols',len(hdr),hdr,'| regrows',[r['req_id'] for r in regrows],'| missing FI',miss_fi,'| missing REG',miss_reg,'| short cell values missing from FI',mv)
  bad+=len(miss_fi)+len(miss_reg)
print('TOTAL missing',bad)
