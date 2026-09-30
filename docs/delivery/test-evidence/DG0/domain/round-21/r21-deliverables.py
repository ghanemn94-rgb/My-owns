import re,csv,json
blocks={b['id']:b for b in json.load(open('docs/source/playbook.blocks.json'))}
md=open('docs/source/playbook.md',encoding='utf-8').read()
inv=open('docs/analysis/field-inventory.md',encoding='utf-8').read()
regtxt=open('docs/delivery/requirements.csv',encoding='utf-8').read()
def n(s): return re.sub(r'\s+',' ',s.replace('<br>',' ').replace('‑','-').replace('’',"'").replace('☐','')).strip().lower()
hay=n(inv+' '+regtxt)
def table(bid):
    m=re.search(rf'<!-- {bid} table -->\n((?:\|.*\n)+)',md)
    return [ [c.strip() for c in l.strip().strip('|').split('|')] for l in m.group(1).strip().split('\n') if not re.match(r'\|[-| ]+\|$',l)] if m else None
groups={'Charter':['B0035'],'Thesis':['B0036','B0037'],'Scope checks':['B0038','B0039','B0040','B0041','B0042','B0043'],
'Outcome hierarchy':['B0048'],'TOM dims':['B0056'],'TOM canvas':['B0062','B0061','B0063'],'Business case':['B0083','B0084','B0085'],
'OS layers':['B0093'],'Lifecycle':['B0121'],'Adoption':[f'B{x:04d}' for x in range(108,117)],'90-day':['B0134','B0135'],'Day-90':[f'B{x:04d}' for x in range(136,142)],
'Roaming':[f'B{x:04d}' for x in range(143,148)],'Health':['B0150','B0151','B0152'],'Roles':['B0017','B0018'],'Modes':['B0008','B0009'],'Phases/gates':['B0021','B0022','B0023'],'Workshop':['B0059','B0061']}
tot=0
for g,ids in groups.items():
    miss=[];cnt=0
    for bid in ids:
        t=table(bid)
        items=[c for r in t for c in r] if t else [blocks[bid]['text']]
        for c in items:
            c2=re.sub(r'^\d+\.\s*','',c.strip())
            if not c2 or c2.startswith('[') or set(c2)<=set('_ '): continue
            cnt+=1
            if n(c2) not in hay:
                # tolerate prose paragraphs if 80% of 6-grams present
                w=n(c2).split(); grams=[' '.join(w[i:i+6]) for i in range(max(1,len(w)-5))]
                frac=sum(g_ in hay for g_ in grams)/len(grams)
                if frac<1: miss.append((bid,round(frac,2),c2[:120]))
    tot+=cnt
    print(f'{g}: items {cnt}, not verbatim {len(miss)}'); [print('    ',m) for m in miss]
print('total',tot)
