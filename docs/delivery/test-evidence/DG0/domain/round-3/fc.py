import csv,json,re
bl=json.load(open('docs/source/playbook.blocks.json'))
reg=list(csv.DictReader(open('docs/delivery/requirements.csv',encoding='utf-8')))
sc={r['block_id']:r for r in csv.DictReader(open('docs/analysis/source-coverage.csv',encoding='utf-8'))}
fi=open('docs/analysis/field-inventory.md',encoding='utf-8').read()
def n(s): return re.sub(r'\s+',' ',s.replace('×','x').replace('–','-').replace('—','-').replace('’',"'")).strip().lower()
allreg=n(' '.join(' '.join(r.values()) for r in reg)); fin=n(fi)
tot=0
for b in bl:
    if b['type']!='table': continue
    if sc[b['id']]['disposition']!='REQUIREMENT': continue
    miss=[]
    for row in b['rows']:
        for c in row:
            for part in re.split(r'\n+',c):
                p=n(part)
                if not p or re.fullmatch(r'\[.*\]',p): continue
                if p not in fin and p not in allreg: miss.append(part)
    if miss: tot+=len(miss);print(b['id'],'missing',len(miss),miss[:12])
# paragraphs (list items) under requirement disposition
pm=0
for b in bl:
    if b['type']=='table' or sc[b['id']]['disposition']!='REQUIREMENT': continue
    t=n(b['text'])
    if t not in fin and t not in allreg: pm+=1
print('TABLE CELLS MISSING',tot,'; requirement paragraphs not verbatim anywhere (expected many - prose):',pm)
