import re,glob,os,sys
R=sys.argv[1]
mig=sorted(glob.glob(R+'/packages/db/migrations/*.sql'))
erd=open(R+'/docs/architecture/erd.md').read()
ents=['initiative','deliverable','milestone','roadmap_wave','dependency','resource_demand','capacity','funding_decision']
for t in ents:
    found=None
    for f in mig:
        s=open(f).read()
        m=re.search(r'CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?'+t+r'\s*\((.*?)\n\);',s,re.S)
        if m: found=(os.path.basename(f),m.group(1)); break
    if not found: print(t,'| NOT FOUND'); continue
    f,body=found
    cols=[l.strip().split()[0] for l in body.split('\n') if l.strip() and not l.strip().upper().startswith(('CONSTRAINT','PRIMARY','UNIQUE','CHECK','FOREIGN','EXCLUDE','--'))]
    pk=bool(re.search(r'PRIMARY KEY',body))
    owner=[c for c in cols if re.search(r'owner|decided_by',c)]
    status=[c for c in cols if re.search(r'status|outcome',c)]
    alters=[os.path.basename(g) for g in mig if re.search(r'ALTER TABLE (?:ONLY )?(?:public\.)?'+t+r'\b',open(g).read())]
    n=len(re.findall(r"\b"+t+r"\b",erd,re.I))
    print(f"{t} | {f} | PK {pk} | owner {owner} | status {status} | erd mentions {n} | ALTERs {alters}")
