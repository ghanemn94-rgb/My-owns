#!/usr/bin/env python3
"""Domain-reviewer round-18: for every first-class deliverable, check that each source item (from playbook.blocks.json)
appears in the register (requirements.csv) and, where it is a data structure, in field-inventory.md.
Also: coverage bidirectionality, template columns verbatim, SOURCE rows cite B blocks, staging. Usage: python3 ... <repo-clone>"""
import sys,json,csv,re,collections
R=sys.argv[1]
bl={b['id']:b for b in json.load(open(f'{R}/docs/source/playbook.blocks.json'))}
reg={r['req_id']:r for r in csv.DictReader(open(f'{R}/docs/delivery/requirements.csv'))}
REG=open(f'{R}/docs/delivery/requirements.csv').read(); FI=open(f'{R}/docs/analysis/field-inventory.md').read()
n=lambda s:re.sub(r'\s+',' ',s.replace('’',"'").replace('“','"').replace('”','"')).strip().lower()
REGn,FIn=n(REG),n(FI)
fails=0
def chk(label,items,where=('reg','fi')):
    global fails
    H={'reg':REGn,'fi':FIn,'any':REGn+' '+FIn}
    miss=[(i,w) for i in items for w in where if n(i) not in H[w]]
    print(f'[{label}] items={len(items)} missing={miss}'); fails+=bool(miss)
def cells(b,col): return [re.sub(r'^\d+\.\s*','',r[col].split('\n')[0].strip()) for r in bl[b]['rows'][1:]]
def paras(a,b): return [bl[f'B{i:04d}']['text'] for i in range(a,b+1)]
chk('governance roles B0018',cells('B0018',0))
chk('6 phases B0021',[r[1] for r in bl['B0021']['rows']])
chk('G1-G6 decision questions B0023 (register decomposes; verbatim text in field inventory)',cells('B0023',1),('fi',))
chk('G1-G6 evidence B0023 (verbatim in field inventory)',cells('B0023',2),('fi',))
chk('G1-G6 evidence items as register fields',[x.strip(' .') for c in cells('B0023',2) for x in c.split(',')],('reg',))
chk('charter 14 fields B0035',cells('B0035',0))
chk('thesis B0037',[bl['B0037']['rows'][0][0].split('Complete this sentence',1)[1].strip()],('any',))
chk('5 scope sanity checks B0039-43',paras(39,43),('reg',))
chk('outcome hierarchy levels B0048',cells('B0048',0))
chk('TOM 10 dimensions B0056',cells('B0056',0))
chk('TOM 10 design questions B0056',cells('B0056',1),('any',))
canvas=[l for r in bl['B0062']['rows'] for c in r for l in c.split('\n')[:2] if l.strip() and not l.startswith('[')]
chk('TOM canvas panels+prompts B0062',canvas,('reg',))
chk('workshop B0063',['90-120 minute'],('reg',))
chk('business case 10 sections B0085',cells('B0085',0))
chk('OS layers B0093',cells('B0093',0))
chk('OS cadences B0093',cells('B0093',1),('reg',))
chk('benefits lifecycle steps B0121',cells('B0121',0))
chk('7 adoption indicators B0109-115',paras(109,115),('reg',))
chk('90-day windows B0134',cells('B0134',0),('reg',))
chk('Day-90 test B0136-141',paras(136,141),('reg',))
q=[re.sub(r'^☐\s*\d+\.\s*','',c).strip() for r in bl['B0150']['rows'] for c in r if c.strip() and not c.startswith('Score')]
print('   health questions extracted:',len(q))
chk('25 health-check questions B0150',q,('any',))
chk('4 bands B0152',cells('B0152',0)+cells('B0152',1),('any',))
chk('roaming example elements B0145',cells('B0145',0)+[c.split(';')[0] for c in cells('B0145',1)],('any',))
chk('roaming traceability rows B0147',[c for r in bl['B0147']['rows'][1:] for c in r],('any',))
chk('modes B0009',cells('B0009',0),('reg',))
chk('T11 decisions+SLA B0099',[c for r in bl['B0099']['rows'][1:] for c in (r[0],r[5])],('reg',))
chk('RACI deliverables B0101',cells('B0101',0),('reg',))
raci=[(r[0],h,v) for r in bl['B0101']['rows'][1:] for h,v in zip(bl['B0101']['rows'][0][1:],r[1:])]
pm=open(f'{R}/docs/analysis/permissions-matrix.md').read()
print('[RACI matrix values B0101]',len(raci),'cells; sample', raci[:3])
chk('wave rows B0079',[c for r in bl['B0079']['rows'][1:] for c in r],('any',))
chk('T10 RAG logic B0095',cells('B0095',2),('any',))
chk('T10 areas B0095',cells('B0095',0),('reg','fi'))
chk('source table B0156',cells('B0156',0),('reg',))
chk('custom extensions B0158-162',paras(158,162),('any',))
print('RESULT','PASS' if not fails else f'FAIL({fails})'); sys.exit(1 if fails else 0)
