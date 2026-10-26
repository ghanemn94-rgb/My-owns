import json,os,re
recs=['docs/delivery/reviews/DG5/round-2/code-security-reviewer.json','docs/delivery/reviews/DG5/round-2/qa-verifier.json','docs/delivery/reviews/DG5/round-3/domain-reviewer.json','docs/delivery/reviews/DG5/round-2/domain-reviewer.json']
pat=re.compile(r'(\b[1-9]\d* failed\b|exit[ =:]+[1-9]\d*|EXIT[ =:]+[1-9]|Timed out|Test timeout|\bflaky\b|ELIFECYCLE|Command failed|ERR!)')
for rp in recs:
    r=json.load(open(rp)); paths=set(r.get('evidence_paths',[]))
    for c in r['checks_run']: paths|=set(c.get('evidence',[]))
    paths={p.split('#')[0] for p in paths}
    miss=[p for p in paths if not os.path.isfile(p)]
    text=json.dumps(r)
    side=rp.replace('.json','.md')
    if os.path.exists(side): text+=open(side).read()
    print(f'\n### {rp}: evidence {len(paths)} missing {miss}')
    for p in sorted(paths):
        if not p.endswith(('.log','.txt','.md')): continue
        hits=[]
        for i,l in enumerate(open(p,errors='replace')):
            if pat.search(l): hits.append((i+1,l.strip()[:160]))
        if hits:
            b=os.path.basename(p); disclosed=b in text or b.rsplit('.',1)[0] in text
            print(f' {p}: {len(hits)} hits; file named in record/narrative: {disclosed}')
            for h in hits[:4]: print('    ',h)
