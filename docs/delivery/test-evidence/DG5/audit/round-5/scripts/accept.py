import json,glob
f=json.load(open('docs/delivery/findings.json')); L=f['findings'] if isinstance(f,dict) else f
by={x['id']:x for x in L}
side={}
for p in sorted(glob.glob('docs/delivery/reviews/DG5/round-*/*.verifications.json')):
    d=json.load(open(p)); ents=d['verifications'] if isinstance(d,dict) else d
    role=p.split('/')[-1].split('.')[0]; rnd=p.split('/')[-3]
    for e in ents: side.setdefault(e['finding_id'],[]).append((rnd,role,e))
for fid,ents in sorted(side.items()):
    print('##',fid,'status in findings.json:',by[fid]['status'])
    latest={}
    for rnd,role,e in ents: latest[role]=(rnd,e)
    for role,(rnd,e) in latest.items(): print('  latest',role,rnd,e['result'],e.get('status_after'))
    acc=[r for r,(rn,e) in latest.items() if e.get('status_after')=='ACCEPTED_OBSERVATION' and e['result']=='PASS']
    a=by[fid].get('acceptance')
    print('  accepting sidecar roles',sorted(acc),'| findings.json acceptance:',None if not a else {k:(v if k!='rationale' else len(v)) for k,v in a.items()})
    if a:
        print('  accepted_by == accepting roles:',sorted(a['accepted_by'])==sorted(acc))
        for part in a['rationale'].split(' | '):
            role,_,q=part.partition(' (round 3): ')
            n=[e for r,(rn,e) in latest.items() if r==role][0]['note']
            print('  rationale quote of',role,'is verbatim prefix of its sidecar note:',n.startswith(q),'len',len(q))
    print('  verification in findings.json:',json.dumps(by[fid].get('verification'))[:300])
