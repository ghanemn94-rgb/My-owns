import csv,re,collections
reg={r['req_id']:r for r in csv.DictReader(open('docs/delivery/requirements.csv',encoding='utf-8'))}
txt=open('docs/source/master-prompt.anchored.md',encoding='utf-8').read()
for b in ['M0403','M0404','M0405','M0406','M0407','M0408','M0409','M0410']:
    m=re.search(rf'\[{b} [^\]]*\] ?(.*)',txt); print(b,re.sub(r'\s+',' ',m.group(1))[:420])
G=['DG0','DG1','DG2','DG3','DG4','DG5','DG6','DG7']
tmpl=collections.defaultdict(set)
for r in reg.values():
    for t in re.findall(r'T\d\d',r['template_id']): tmpl[t].add((r['req_id'],r['final_gate']))
print('\nTemplate final gates (§21: T01-T04 at DG2; T05-T09 at DG3; T10-T16 at DG4):')
exp={**{f'T{i:02d}':'DG2' for i in range(1,5)},**{f'T{i:02d}':'DG3' for i in range(5,10)},**{f'T{i:02d}':'DG4' for i in range(10,17)}}
bad=[]
for t in sorted(tmpl):
    gs=sorted(tmpl[t]); print(' ',t,gs)
    core=[g for _,g in gs]
    if exp.get(t) not in core: bad.append((t,'no row finishing at',exp.get(t)))
    if any(G.index(g)<G.index(exp[t]) for g in core): bad.append((t,'row finishes before expected gate'))
print('template staging problems',bad)
# gates G1..G6 final gates
for q in ['G1','G2','G3','G4','G5','G6']:
    rows=[(r['req_id'],r['final_gate']) for r in reg.values() if re.search(rf'\b{q}\b',r['title']) and r['req_id'].startswith('REQ-PB')]
    print(' ',q,rows)
# increments well-formed and final gate is the last increment
probs=[]
for r in reg.values():
    inc=['DG'+x[1:] if re.fullmatch(r'P\d',x) else x for x in re.split(r'[;, ]+',r['increments']) if x]
    if r['final_gate'] not in G: probs.append((r['req_id'],'bad final',r['final_gate']))
    if any(x not in G for x in inc): probs.append((r['req_id'],'bad inc',inc))
    elif inc and max(inc,key=G.index)!=r['final_gate']: probs.append((r['req_id'],'final!=last increment',inc,r['final_gate']))
    if not r['acceptance'].strip() or not re.search(r'A\d\d',r['acceptance']): probs.append((r['req_id'],'acceptance lacks A-test ref'))
print('increment/acceptance problems',len(probs),probs[:15])
print('final gate distribution',collections.Counter(r['final_gate'] for r in reg.values()))
print('DG0-final rows',[r['req_id'] for r in reg.values() if r['final_gate']=='DG0'])
print('DG0-final status',collections.Counter(r['status'] for r in reg.values() if r['final_gate']=='DG0'))
for i in ['REQ-DLV-001','REQ-DLV-002','REQ-DLV-020','REQ-DLV-032']:
    r=reg[i]; print(f"\n{i} [{r['class']}/{r['status']}/final {r['final_gate']}] {r['title']}\n  P: {r['procedure']}\n  A: {r['acceptance']}\n  E: {r['evidence']}")
    import os
    for e in [x.strip() for x in re.split(r'[;]',r['evidence']) if x.strip()]:
        p=e.split('#')[0]; print('   evidence',e,'exists' if os.path.isfile(p) else 'MISSING')
