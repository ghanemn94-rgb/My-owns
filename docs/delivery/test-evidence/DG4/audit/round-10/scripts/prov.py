import json,hashlib,os,glob,sys,datetime
R='/home/user/My-owns'; os.chdir(R)
def sha(p): return hashlib.sha256(open(p,'rb').read()).hexdigest()
print('# 02 provenance - release-auditor round 10 (%s)'%datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'))
recs={'domain-reviewer':None,'code-security-reviewer':None,'qa-verifier':None}
runs=set();sess=set()
for role in recs:
  rec=json.load(open(f'docs/delivery/reviews/DG4/round-10/{role}.json'))
  ir=rec['invocation_reference']; d=f"docs/delivery/runs/DG4/{ir['run_id']}"
  m=json.load(open(d+'/meta.json'))
  print(f"\n== {role}: run {ir['run_id']}")
  print(' record.invocation_reference == meta.invocation_reference:', ir==m['invocation_reference'])
  print(' meta.role:',m['role'],' task:',m['task'],' assignment:',m['assignment'])
  print(' assignment sha256 matches meta:', sha(m['assignment'])==m['assignment_sha256'])
  print(' head_commit_at_start:',m['head_commit_at_start'],' started',m['started_at'],' finished',m['finished_at'])
  print(' exit_code',m['exit_code'],' is_error',m['is_error'],' subtype',m['subtype'],' resumes',m.get('classifier_outage_resumes'))
  print(' bash_sandbox',m['bash_sandbox'],' process_sandbox',m['process_sandbox'],' sha256(sandbox.json)==meta.process_sandbox_sha256:', sha(d+'/sandbox.json')==m['process_sandbox_sha256'])
  print(' settings sha matches:', sha(d+'/settings.json')==m.get('settings_sha256'), ' result sha matches:', sha(d+'/result.json')==m.get('result_sha256'), ' transcript sha matches:', sha(d+'/transcript.jsonl.gz')==m.get('transcript_sha256'))
  print(' external_config_changed',m['external_config_changed'],' process_sandbox_discarded',m['process_sandbox_discarded'],' deleted',m['deleted'])
  print(' written_by_tools:',m['written_by_tools'])
  for p,h in m['tool_authored'].items(): print('  tool_authored',p,'current sha matches:', sha(p)==h)
  own_prefixes=(f'docs/delivery/reviews/DG4/round-10/{role}.', )
  key={'domain-reviewer':'domain','code-security-reviewer':'code-security','qa-verifier':'qa'}[role]
  ok_pref=own_prefixes+(f'docs/delivery/test-evidence/DG4/{key}/',)
  bad=[p for p in m['written_by_tools'] if not p.startswith(ok_pref)]
  print(' tool writes outside own round-10 record / own evidence key:', bad or 'none')
  others=[p for p in m['outputs'] if not p.startswith(ok_pref) and not p.startswith(f"docs/delivery/runs/DG4/{ir['run_id']}")]
  print(' snapshot outputs not under own areas (count):',len(others))
  for p in others[:12]: print('   ',p)
  print(' record candidate/source:',rec['candidate_id'],rec['source_commit'],' verdict',rec['verdict'],' round',rec.get('round'),' reviewed_at',rec['reviewed_at'])
  runs.add(ir['run_id']); sess.add(ir['session_id'])
print('\nDistinct run_ids:',len(runs),' distinct session_ids:',len(sess))
print('\n## all DG4 run directories')
print('run_id | role | exit | is_error | subtype | bash_sb | proc_sb | sandbox_sha_match | ext_cfg_changed | discarded | deleted')
for d in sorted(glob.glob('docs/delivery/runs/DG4/*/')):
  mp=d+'meta.json'
  if not os.path.exists(mp): print('NO meta.json (in-flight or orphaned):',d); continue
  m=json.load(open(mp))
  e=m.get('external_config_changed') or []
  es='[]' if not e else f"{len(e)} paths under {sorted(set('/'.join(p.split('/')[:5]) for p in e))}"
  sm = os.path.exists(d+'sandbox.json') and sha(d+'sandbox.json')==m.get('process_sandbox_sha256')
  print(' | '.join(map(str,[m['run_id'],m['role'],m.get('exit_code'),m.get('is_error'),m.get('subtype'),m.get('bash_sandbox'),m.get('process_sandbox'),sm,es,len(m.get('process_sandbox_discarded') or []),len(m.get('deleted') or [])])))
print('\n## D-082: DG4 review/audit runs (REV-*, AUDIT-*) with non-empty external_config_changed')
n=0
for d in sorted(glob.glob('docs/delivery/runs/DG4/*/')):
  if not ('-REV-' in d or '-AUDIT-' in d): continue
  mp=d+'meta.json'
  if not os.path.exists(mp): continue
  m=json.load(open(mp)); n+=1
  if m.get('external_config_changed'): print(' NON-EMPTY:',m['run_id'],len(m['external_config_changed']))
print(' review/audit runs with meta checked:',n)
