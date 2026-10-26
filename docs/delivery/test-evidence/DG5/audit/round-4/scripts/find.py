import json,subprocess,re
f=json.load(open('docs/delivery/findings.json'))
L=f['findings'] if isinstance(f,dict) else f
dg5=[x for x in L if x.get('id','').startswith('F-DG5-')]
print('DG5 findings',len(dg5))
for x in dg5:
    fr=x.get('fix_revision'); anc=None
    if fr: anc=subprocess.run(['git','merge-base','--is-ancestor',fr,'660f40c7d141b6fb73c145e0ee7a053ceb5905de']).returncode==0
    print(json.dumps({k:x.get(k) for k in ('id','severity','mandatory_violation','status','owner','reported_by','verified_by','fix_revision','requirement_id')}), 'full40',bool(fr and re.fullmatch('[0-9a-f]{40}',fr)),'ancestor',anc)
    if x.get('status') not in ('CLOSED_VERIFIED','ACCEPTED_OBSERVATION'): print('  NON-TERMINAL')
    print('  keys:',sorted(x.keys()))
