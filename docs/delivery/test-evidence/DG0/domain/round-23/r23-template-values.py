import re,csv
md=open('docs/source/playbook.md',encoding='utf-8').read().split('\n')
inv=open('docs/analysis/field-inventory.md',encoding='utf-8').read()
reg={r['req_id']:r for r in csv.DictReader(open('docs/delivery/requirements.csv',encoding='utf-8'))}
def cells(l): return [c.strip() for c in l.strip().strip('|').split('|')]
def n(s): return re.sub(r'\s+',' ',s.replace('‑','-')).strip().lower()
tot=0;miss=[]
for i,l in enumerate(md):
    m=re.match(r'Template (\d+) — ',l)
    if not m: continue
    tid=f'T{int(m.group(1)):02d}'; j=i+1
    while not md[j].startswith('|'): j+=1
    hdr=cells(md[j]); k=j+2; rows=[]
    while k<len(md) and md[k].startswith('|'): rows.append(cells(md[k])); k+=1
    sec=re.search(rf'^## {tid} — .*?(?=^## )',inv,re.S|re.M).group(0)
    reqs=re.findall(r'REQ-PB-\d+',sec.split('\n')[0])
    hay=n(sec+' '+' '.join(' '.join(reg[r].values()) for r in reqs))
    if tid=='T12':  # RACI cells: check per row the row+letters appear
        for r in rows:
            tot+=1
            ok=all(n(x) in hay for x in r[:1]) and re.search(re.escape(n(r[0])),hay)
            # check exact mapping line in inventory
            line=[x for x in sec.split('\n') if x.lower().find(r[0].lower())>=0 and '|' in x]
            letters=r[1:]
            good=any(all(f'| {a} ' in x+' ' or f'|{a}|' in x.replace(' ','') for a in letters) and [c.strip() for c in x.strip().strip('|').split('|')][-6:]==letters for x in line)
            if not good: miss.append((tid,'RACI row',r,line[:2]))
        continue
    for r in rows:
        for c in r:
            if not c or c.startswith('['): continue
            tot+=1
            parts=[p.strip() for p in re.split(r'\s/\s',c)] if ' / ' in c and len(c)<40 else [c]
            for p in parts:
                if n(p) not in hay: miss.append((tid,c,p))
print('cells checked',tot); print('missing',len(miss))
for x in miss: print('  ',x)
