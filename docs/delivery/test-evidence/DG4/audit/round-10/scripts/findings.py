import json,subprocess,os,hashlib
R='/home/user/My-owns'; os.chdir(R); C=os.environ['TMPDIR']+'/c'
F=json.load(open('docs/delivery/findings.json'))['findings']
D=[x for x in F if x['id'].startswith('F-DG4')]
print('# 03 findings - release-auditor round 10'); print('DG4 findings:',len(D))
side={}
for role in ['domain-reviewer','code-security-reviewer','qa-verifier','release-auditor']:
  p=f'docs/delivery/reviews/DG4/round-9/{role}.verifications.json'
  if os.path.exists(p):
    for v in json.load(open(p))['verifications']: side.setdefault(v['finding_id'],[]).append((role,v))
def anc(rev):
  r=subprocess.run(['git','-C',C,'merge-base','--is-ancestor',rev,'e70ac02f63cd1f42487cfa4dae73f68e933da015']).returncode
  t=subprocess.run(['git','-C',C,'cat-file','-t',rev],capture_output=True,text=True).stdout.strip()
  return t, r==0
from collections import Counter
cnt=Counter()
for x in D:
  v=x.get('verification') or {}
  st=x['status']; cnt[st]+=1
  line=f"{x['id']} {x['severity']} mand={x['mandatory_violation']} owner={x['owner']} reporter={x['reported_by']} status={st}"
  if x.get('fix_revision'):
    t,a=anc(x['fix_revision']); line+=f" fix={x['fix_revision'][:12]} full={len(x['fix_revision'])==40} type={t} ancestor_of_e70ac02={a}"
  if v:
    ir=v['invocation_reference']; m=json.load(open(f"docs/delivery/runs/DG4/{ir['run_id']}/meta.json"))
    sb=hashlib.sha256(open(f"docs/delivery/runs/DG4/{ir['run_id']}/sandbox.json",'rb').read()).hexdigest()==m['process_sandbox_sha256']
    line+=f"\n   verifier={v['by_role']} non_owner={v['by_role']!=x['owner']} run={ir['run_id']} exit={m['exit_code']} subtype={m['subtype']} ext_cfg={m['external_config_changed']} sandbox_match={sb}"
    s=[e for r,e in side.get(x['id'],[]) if r==v['by_role']]
    if s:
      last=s[-1]; line+=f"\n   round-9 sidecar latest ({v['by_role']}): {last['result']} -> {last['status_after']}; matches findings.json status: {last['status_after']==st}"
    else: line+="\n   NO round-9 sidecar entry by verifier"
  if x.get('acceptance'): line+=f"\n   acceptance: {json.dumps({k:x['acceptance'][k] for k in x['acceptance'] if k!='rationale'})}"
  print(line)
print('\nstatus counts:',dict(cnt))
unres=[x['id'] for x in D if x['status'] not in ('CLOSED_VERIFIED','ACCEPTED_OBSERVATION')]
print('not CLOSED_VERIFIED/ACCEPTED_OBSERVATION:',unres)
print('unresolved Critical/High:',[x['id'] for x in D if x['id'] in unres and x['severity'] in ('Critical','High')])
print('unresolved mandatory:',[x['id'] for x in D if x['id'] in unres and x['mandatory_violation']])
