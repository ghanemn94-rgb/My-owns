#!/usr/bin/env python3
"""Domain-reviewer round-16 mechanical checks. Run from a clone of the candidate: python3 domain-checks-r16.py <repo> <extracted-docx-dir>"""
import csv,json,re,html,unicodedata,sys,os,collections
R,DX=sys.argv[1],sys.argv[2]
def p(*a): print(*a)
def norm(s):
    s=html.unescape(s); s=unicodedata.normalize('NFKC',s)
    s=s.replace('’',"'").replace('‘',"'").replace('“','"').replace('”','"')
    return re.sub(r'\s+','',re.sub(r'[|*#`>]','',s))
fails=0
# 1 extraction fidelity both directions
x=open(f'{DX}/word/document.xml',encoding='utf8').read()+open(f'{DX}/word/footer1.xml',encoding='utf8').read()
md=open(f'{R}/docs/source/playbook.md',encoding='utf8').read()
mdn=norm(re.sub(r'<!--.*?-->','',md).replace('<br>','\n'))
segs=[]
for para in re.findall(r'<w:p[ >].*?</w:p>',x,flags=re.S):
    for ch in re.split(r'<w:br/>|<w:cr/>|<w:tab/>',para):
        t=''.join(re.findall(r'<w:t(?: [^>]*)?>([^<]*)</w:t>',ch))
        if t.strip(): segs.append(t)
miss=[s for s in segs if norm(s) not in mdn]
# running header/footer text is recorded in an HTML comment at the top of playbook.md (F-DG0-004 fix); accept it there
mdc=norm(md.replace('<br>','\n'))
miss_body=miss; miss=[s for s in miss if norm(s) not in mdc]
if miss_body: print('    segments found only inside the extractor header comment:',miss_body)
d=norm(''.join(re.findall(r'<w:t(?: [^>]*)?>([^<]*)</w:t>',x)))
extra=[]
for ln in md.splitlines():
    ln=re.sub(r'<!--.*?-->','',ln).strip()
    if not ln or re.fullmatch(r'[|\-: ]+',ln): continue
    for cell in re.split(r'\||<br>',ln):
        c=norm(cell)
        if c and c not in d: extra.append(cell)
p(f'[1] docx text segments={len(segs)} missing_from_md={len(miss)}; md fragments not in docx={len(extra)}'); fails+=bool(miss or extra)
# 2 coverage
bl={b['id']:b for b in json.load(open(f'{R}/docs/source/playbook.blocks.json'))}
reg={r['req_id']:r for r in csv.DictReader(open(f'{R}/docs/delivery/requirements.csv'))}
sc=list(csv.DictReader(open(f'{R}/docs/analysis/source-coverage.csv')))
bad=[]
for r in sc:
    ids=[i for i in re.split(r'[;\s]+',r['req_ids']) if i]
    if r['disposition']=='REQUIREMENT' and not ids: bad.append(r['block_id'])
    for i in ids:
        if i not in reg or r['block_id'] not in reg[i]['source_ref']: bad.append((r['block_id'],i))
p(f'[2] blocks={len(bl)} coverage_rows={len(sc)} dispositions={dict(collections.Counter(r["disposition"] for r in sc))} inconsistencies={bad}'); fails+=bool(bad) or len(sc)!=165
# 3 template columns verbatim
fi=open(f'{R}/docs/analysis/field-inventory.md').read()
tpl={'T01':'B0031','T02':'B0050','T03':'B0058','T04':'B0065','T05':'B0072','T06':'B0076','T07':'B0079','T08':'B0081','T09':'B0087','T10':'B0095','T11':'B0099','T12':'B0101','T13':'B0107','T14':'B0123','T15':'B0128','T16':'B0130','CHARTER':'B0035'}
for t,b in tpl.items():
    rows=bl[b]['rows']; cols=[r[0] for r in rows[1:]] if t in('T05','CHARTER') else rows[0]
    inp=';'.join(r['input_fields'] for r in reg.values() if t in r['template_id'].split(';'))
    mr=[c for c in cols if c not in inp]; mf=[c for c in cols if c not in fi]
    p(f'[3] {t} cols={len(cols)} missing_in_register={mr} missing_in_field_inventory={mf}'); fails+=bool(mr or mf)
# 3b value lists / seeds present verbatim in register
regtxt=open(f'{R}/docs/delivery/requirements.csv').read()
for v in ['H / M / L','Support / Neutral / Resist','Decision / Tech / Data / Vendor','Risk/Assumption/Issue/Dependency','A/R','25/25/20/15/15','0-6 weeks','1-3 months','3-9 months','6-18 months','5 working days','Next SteerCo / urgent route','10 working days','Per release plan','target trajectory, not activity completion','validated benefit gap','milestone + outcome risk','decision date / critical path','vs adoption curve','Red if executive decision overdue','21-25','16-20','10-15','0-9']:
    ok=v in regtxt; p(f'[3b] {v!r} in register: {ok}'); fails+= not ok
# 4 master prompt coverage bidirectional
mc={r['block_id']:r for r in csv.DictReader(open(f'{R}/docs/analysis/master-prompt-coverage.csv'))}
bad=[]
for c in mc.values():
    ids=[i for i in re.split(r'[;\s]+',c['req_ids']) if i]
    if c['disposition']=='REQUIREMENT' and not ids: bad.append(c['block_id'])
    for i in ids:
        if i not in reg or c['block_id'] not in reg[i]['source_ref']: bad.append((c['block_id'],i))
for r in reg.values():
    for m in re.findall(r'M\d{4}',r['source_ref']):
        if r['req_id'] not in mc[m]['req_ids']: bad.append(('rev',m,r['req_id']))
    if r['class']=='SOURCE' and not re.search(r'B\d{4}',r['source_ref']): bad.append(('SOURCE-noB',r['req_id']))
    if r['class']!='SOURCE' and re.search(r'B\d{4}',r['source_ref']): bad.append(('nonSOURCE-cites-B',r['req_id']))
p(f'[5/8] M blocks={len(mc)} dispositions={dict(collections.Counter(c["disposition"] for c in mc.values()))} inconsistencies={bad}'); fails+=bool(bad)
# 9 staging
bad=[]
for r in reg.values():
    inc=[i for i in r['increments'].split(';') if i]
    if not inc or r['final_gate']!=f'DG{max(int(i[1:]) for i in inc)}': bad.append(r['req_id'])
exp={'DG2':['T01','T02','T03','T04','CHARTER','TOM-CANVAS'],'DG3':['T05','T07','T08','T09','BIZCASE'],'DG5':['HEALTH25','ROAMING-EX','LAUNCH90']}
for g,ts in exp.items():
    for r in reg.values():
        if any(t in r['template_id'].split(';') for t in ts) and r['final_gate']!=g and r['req_id'] not in ('REQ-PB-032',): bad.append((r['req_id'],r['template_id'],r['final_gate'],'exp',g))
for r in reg.values():
    if any(t in r['template_id'].split(';') for t in ['T10','T11','T12','T13','T14','T15','T16']) and r['final_gate']!='DG4': bad.append((r['req_id'],r['final_gate']))
gates={'REQ-PB-016':'DG2','REQ-PB-017':'DG2','REQ-PB-018':'DG2','REQ-PB-019':'DG3','REQ-PB-020':'DG4','REQ-PB-021':'DG4'}
for k,v in gates.items():
    if reg[k]['final_gate']!=v: bad.append((k,reg[k]['final_gate']))
p(f'[9] staging inconsistencies={bad}'); fails+=bool(bad)
p('RESULT', 'PASS' if not fails else f'FAIL ({fails})'); sys.exit(1 if fails else 0)
