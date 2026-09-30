#!/usr/bin/env python3
"""Round-19 domain check: T01-T16 columns verbatim in field-inventory section AND register input_fields of mapped REQs.
Usage: r19-template-columns.py <clone>"""
import sys,json,csv,re
R=sys.argv[1]
bl=json.load(open(f'{R}/docs/source/playbook.blocks.json'))
reg={r['req_id']:r for r in csv.DictReader(open(f'{R}/docs/delivery/requirements.csv'))}
FI=open(f'{R}/docs/analysis/field-inventory.md').read()
n=lambda s:re.sub(r'\s+',' ',s.replace('’',"'").replace('<br>',' ')).strip().lower()
fails=0
for T in range(1,17):
    i=next(k for k,b in enumerate(bl) if (b.get('text') or '').startswith(f'Template {T} —'))
    tb=next(b for b in bl[i+1:i+4] if b['type']=='table')
    rows=tb['rows']
    vertical = len(rows[0])==2 and len(rows)>3 and not any(h.lower() in('example','value') for h in rows[0][1:])
    fields=[r[0] for r in rows] if vertical else rows[0]
    fields=[f.split('\n')[0].strip() for f in fields if f.strip()]
    m=re.search(rf'^## T{T:02d} — .*?→ (.*)$',FI,flags=re.M)
    sec=FI[m.start():FI.find('\n## ',m.end())]
    reqs=re.findall(r'REQ-[A-Z0-9]+-\d+',m.group(1))
    regin=n(' ; '.join(reg[q]['input_fields']+' '+reg[q]['procedure']+' '+reg[q]['acceptance'] for q in reqs))
    regIN=n(' ; '.join(reg[q]['input_fields'] for q in reqs))
    mf=[f for f in fields if n(f) not in n(sec)]
    mr=[f for f in fields if n(f) not in regIN]
    print(f'T{T:02d} {tb["id"]} {"vertical" if vertical else "horizontal"} fields={len(fields)} reqs={reqs}')
    print(f'    cols: {fields}')
    print(f'    missing in field-inventory section: {mf}\n    missing in register input_fields: {mr}')
    # example-row cells: value lists like 'H/M/L'
    ex=[c for r in (rows if vertical else rows[1:]) for c in (r[1:] if vertical else r)]
    vl=sorted({v for c in ex for v in re.findall(r'\b[A-Za-z]+(?:\s?/\s?[A-Za-z]+)+\b',c)})
    mv=[v for v in vl if n(v).replace(' ','') not in n(sec).replace(' ','') and n(v).replace(' ','') not in regin.replace(' ','')]
    print(f'    slash value-lists in examples: {vl}\n    value-lists missing from both: {mv}')
    fails+=bool(mf or mr or mv)
print('RESULT','PASS' if not fails else f'FAIL({fails})'); sys.exit(1 if fails else 0)
