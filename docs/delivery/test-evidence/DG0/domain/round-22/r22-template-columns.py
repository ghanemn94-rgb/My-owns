import re,csv,json,sys
md=open('docs/source/playbook.md',encoding='utf-8').read().split('\n')
inv=open('docs/analysis/field-inventory.md',encoding='utf-8').read()
reg={r['req_id']:r for r in csv.DictReader(open('docs/delivery/requirements.csv',encoding='utf-8'))}
def cells(l): return [c.strip() for c in l.strip().strip('|').split('|')]
fail=0
for i,l in enumerate(md):
    m=re.match(r'Template (\d+) — (.*?) <!--',l)
    if not m: continue
    n=int(m.group(1)); j=i+1
    while not md[j].startswith('|'): j+=1
    hdr=cells(md[j]); rows=[]
    k=j+2
    while k<len(md) and md[k].startswith('|'): rows.append(cells(md[k])); k+=1
    tid=f'T{n:02d}'
    sec=re.search(rf'^## {tid} — .*?(?=^## )',inv,re.S|re.M).group(0)
    reqs=re.findall(r'REQ-PB-\d+',sec.split('\n')[0])
    invfields=[cells(x)[1] for x in sec.split('\n') if re.match(r'\| \d+ \|',x)]
    regtxt=' '.join(reg[r]['input_fields']+' '+reg[r]['template_id'] for r in reqs)
    # vertical table detection: first header is a field label and rows are fields
    cols=hdr
    miss_inv=[c for c in cols if c not in invfields]
    miss_reg=[c for c in cols if c not in regtxt]
    vert=None
    if miss_inv:
        vert=[r[0] for r in [hdr]+rows]
        mv=[c for c in vert if c not in invfields and c not in sec]
    print(f'{tid} {m.group(2)} cols={cols} rows={len(rows)} reqs={reqs} template_ids={[reg[r]["template_id"] for r in reqs]}')
    print('   missing in inventory field col:',miss_inv,'| missing in register input_fields:',miss_reg)
    if vert: print('   vertical/first-col labels:',vert,'missing in inventory section:',mv)
    if miss_reg: fail=1
sys.exit(fail)
