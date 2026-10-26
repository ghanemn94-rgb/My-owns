import json,glob,hashlib,os,re,subprocess
R='/home/user/My-owns'; os.chdir(R)
def sha(p): return hashlib.sha256(open(p,'rb').read()).hexdigest()
roles={'domain-reviewer','code-security-reviewer','qa-verifier','release-auditor'}
impl_roles=set(); print('## all DG5 runs')
rev=[]
for d in sorted(glob.glob('docs/delivery/runs/DG5/*/')):
    mp=d+'meta.json'
    if not os.path.exists(mp): print('NO META', d); continue
    m=json.load(open(mp))
    if m['role'] not in roles: impl_roles.add(m['role']); continue
    rev.append((d,m))
bad=0
for d,m in rev:
    sb=d+'sandbox.json'; sbok=os.path.exists(sb) and sha(sb)==m.get('process_sandbox_sha256')
    ok=m.get('exit_code')==0 and m.get('subtype')=='success' and m.get('is_error') is False and m.get('process_sandbox') and m.get('bash_sandbox') and sbok and m.get('external_config_changed')==[] and m.get('deleted')==[] and m.get('process_sandbox_discarded')==[]
    wr=m.get('written_by_tools',[]);
    if isinstance(wr,str): wr=eval(wr)
    allowed=('docs/delivery/reviews/DG5/','docs/delivery/test-evidence/DG5/')+(('tests/qa/','e2e/') if m['role']=='qa-verifier' else ())
    outside=[w for w in wr if not w.startswith(allowed)]
    if not ok or outside: bad+=1
    print(os.path.basename(d.rstrip('/')), m['role'], 'exit',m.get('exit_code'),m.get('subtype'),'err',m.get('is_error'),'psb',m.get('process_sandbox'),'bsb',m.get('bash_sandbox'),'sbsha',sbok,'ext',m.get('external_config_changed'),'del',m.get('deleted'),'disc',m.get('process_sandbox_discarded'),'outside',outside,'OK' if ok and not outside else 'PROBLEM')
print('review runs',len(rev),'problems',bad)
print('implementation roles in DG5 runs:',sorted(impl_roles),'; reviewer role among them:',sorted(impl_roles&roles))
print('## gate records binding')
recs={'code-security-reviewer':'docs/delivery/reviews/DG5/round-2/code-security-reviewer.json','qa-verifier':'docs/delivery/reviews/DG5/round-2/qa-verifier.json','domain-reviewer':'docs/delivery/reviews/DG5/round-3/domain-reviewer.json','domain-reviewer(r2 full)':'docs/delivery/reviews/DG5/round-2/domain-reviewer.json','release-auditor(r3)':'docs/delivery/reviews/DG5/round-3/release-auditor.json'}
sess=[]
for k,p in recs.items():
    r=json.load(open(p)); ir=r['invocation_reference']; d='docs/delivery/runs/DG5/'+ir['run_id']+'/'
    m=json.load(open(d+'meta.json')); ta=m['tool_authored']; ta=eval(ta) if isinstance(ta,str) else ta
    side=[q for q in glob.glob(os.path.dirname(p)+'/'+r['reviewer_role']+'.*.json')]
    print(k, 'ir==meta',ir==m['invocation_reference'],'role',r['reviewer_role']==m['role'],'session==result',m['result_session_id']==ir['session_id'],'rec sha==tool_authored',ta.get(p)==sha(p),'assignment sha',sha(m['assignment'])==m['assignment_sha256'], 'sidecars',{os.path.basename(s):ta.get(s)==sha(s) for s in side})
    print('   verdict',r['verdict'],'cand',r['candidate_id'][-12:],'src',r['source_commit'],'full40',bool(re.fullmatch('[0-9a-f]{40}',r['source_commit'])),'checks',len(r['checks_run']),'nonPASS',[c.get('id') for c in r['checks_run'] if c.get('result')!='PASS'], 'self-declared author',r['independence_declaration'].get('reviewer_authored_reviewed_scope'))
    sess.append(ir['session_id'])
print('distinct sessions',len(set(sess))==len(sess),sess)
print('## all DG5 review records source_commit')
for p in sorted(glob.glob('docs/delivery/reviews/DG5/round-*/*.json')):
    r=json.load(open(p))
    if 'source_commit' in r: print(p, r['source_commit'], bool(re.fullmatch('[0-9a-f]{40}',r['source_commit'])), r.get('verdict'))
