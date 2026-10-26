import re
L=open('docs/delivery/decisions.md').read().splitlines()
rows={}
for l in L:
    m=re.match(r'\|\s*(D-\d{3})\s*\|',l)
    if m: rows[m.group(1)]=[c.strip() for c in l.strip().strip('|').split('|')]
miss=[];short=[]
for n in range(141,192):
    k=f'D-{n}'
    if k not in rows: miss.append(k); continue
    c=rows[k]
    if len(c)<6 or not c[3] or not c[4] : short.append((k,len(c)))
print('D-141..D-191 present',51-len(miss),'/51 missing',miss,'malformed',short)
print('decision cell length range',min(len(rows[f"D-{n}"][3]) for n in range(141,192) if f"D-{n}" in rows),max(len(rows[f"D-{n}"][3]) for n in range(141,192) if f"D-{n}" in rows))
for k in ('D-184','D-190','D-191'):
    print(f'\n{k} decision (cell 4, first 600 chars, verbatim):',rows[k][3][:600]); print(f'{k} evidence cell 5 (first 400, verbatim):',rows[k][4][:400])
p=open('docs/delivery/progress.md').read()
i=p.find('**Decision (as D-183 and D-189):**'); print('\nD-192 in progress.md (verbatim):',p[i:i+700])
j=p.find('## D-192 follow-up'); print('\nD-192 follow-up (verbatim):',p[j:j+600])
