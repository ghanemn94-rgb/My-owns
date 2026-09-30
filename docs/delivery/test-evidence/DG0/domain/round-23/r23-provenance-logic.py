import csv,re,subprocess,collections,sys
reg={r['req_id']:r for r in csv.DictReader(open('docs/delivery/requirements.csv',encoding='utf-8'))}
cols=list(next(iter(reg.values())).keys())
print('columns',cols)
def txt(r): return ' | '.join(f'{k}={v}' for k,v in r.items())
# --- provenance labels on SOURCE rows
src=[r for r in reg.values() if r['class']=='SOURCE']
iss=[]
for r in src:
    n=r.get('notes','')
    m=[x for x in re.findall(r'M\d{4}',r['source_ref'])]
    if 'Playbook (' not in n: iss.append((r['req_id'],'no Playbook( label'))
    if m and 'Master-prompt additions' not in n: iss.append((r['req_id'],'M refs, no MP label'))
    if 'Interpretations' not in n: iss.append((r['req_id'],'no Interpretations label'))
print('SOURCE rows',len(src),'label issues',iss)
for rid in sorted({i[0] for i in iss}):
    print('  ',rid,'notes:',reg[rid].get('notes','')[:700])
print('USER/ENGINEERING rows citing no M block:',[r['req_id'] for r in reg.values() if r['class'] in('USER','ENGINEERING') and not re.search(r'M\d{4}',r['source_ref'])])
print('USER/ENGINEERING rows citing only B blocks:',[r['req_id'] for r in reg.values() if r['class'] in('USER','ENGINEERING') and re.search(r'B\d{4}',r['source_ref']) and not re.search(r'M\d{4}',r['source_ref'])])
# --- honesty scan over the whole candidate spec surface
files=subprocess.run(['git','ls-files','docs/analysis','docs/delivery/requirements.csv','docs/delivery/requirements-spec.md','docs/delivery/decisions.md','docs/delivery/threat-model.md','CLAUDE.md','docs/delivery/agent-protocol.md','.claude/agents'],capture_output=True,text=True).stdout.split()
bad=[]
for f in files:
    for i,l in enumerate(open(f,encoding='utf-8'),1):
        for pat in [r'official PMI',r'PMI[- ]certified',r'certified product',r'PMI standard',r'official Mobily',r'Mobily brand compliant',r'#0078FF']:
            for m in re.finditer(pat,l,re.I):
                ctx=l[max(0,m.start()-160):m.end()+160]
                neg=re.search(r"\b(not|never|no|n't|without|nor|neither|provisional|unverified|avoid|claim)\b",ctx,re.I)
                if not neg: bad.append((f,i,pat,ctx.strip()))
print('honesty hits without nearby negation/provisional qualifier:',len(bad))
for b in bad: print('  ',b)
# --- operating-logic rows (read in full)
rules={
 'RAG from trajectory, not task completion':['REQ-PB-063','REQ-PB-064','REQ-S07-007','REQ-S01-005','REQ-S04-002'],
 'separate delivery/adoption/value/closure':['REQ-PB-009','REQ-S03-003'],
 'forecast never validated value':['REQ-PB-058','REQ-PB-076','REQ-S08-001','REQ-S13-008'],
 'Finance validates, Business Owner accountable':['REQ-PB-012','REQ-PB-013','REQ-PB-055','REQ-PB-075'],
 'shared benefit once / allocation <=100% / unallocated':['REQ-PB-059','REQ-S08-013'],
 'gates evidence-tied approvals':['REQ-PB-015','REQ-PB-016','REQ-S04-012'],
 'DG0-DG7 separate from G1-G6':['REQ-DLV-004','REQ-DLV-005'],
}
for k,ids in rules.items():
    print('\n==',k)
    for i in ids:
        if i not in reg: print('   (no such row)',i); continue
        r=reg[i]; print(f"   {i} [{r['class']}/{r['status']}/final {r['final_gate']}] {r['title']}\n      P: {r.get('behaviour',r.get('procedure',''))[:500]}\n      A: {r.get('acceptance','')[:500]}")
# regex discovery for rows I may have missed
pats={'double count':r'double[- ]count|counted once|count(ed)? only once','forecast':r'forecast','unallocated':r'unallocated','task completion':r'task completion','Business Owner accountable':r'Business Owner.{0,40}accountab|accountab.{0,40}Business Owner'}
for k,p in pats.items():
    print('\n-- regex',k,[r['req_id'] for r in reg.values() if re.search(p,txt(r),re.I)])
