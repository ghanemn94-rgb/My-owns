import json,os,re,glob
os.chdir('/home/user/My-owns')
roles={'domain-reviewer':'domain','code-security-reviewer':'code-security','qa-verifier':'qa'}
print('# 08 evidence honesty - release-auditor round 10')
allcited=set(); missing=[]
for role in roles:
  r=json.load(open(f'docs/delivery/reviews/DG4/round-10/{role}.json'))
  cited=set(r['evidence_paths'])
  for c in r['checks_run']: cited|=set(c.get('evidence',[]))
  for p in cited:
    q=p.split('#')[0]
    if not os.path.isfile(q): missing.append((role,p))
  allcited|={p.split('#')[0] for p in cited}
  print(f'{role}: cited evidence entries {len(cited)}')
print('cited entries that are not an existing regular file:',missing)
pat=re.compile(r'(EXIT [1-9]|exit[=_: ]+[1-9]\d*\b|exit_status: [1-9]|\bFAIL\b|✗|×|failed \(|Tests .*failed|timed out|Timeout|hook timed|skipped|ERR!|Error:|EROFS|ENOENT|Killed|SIGTERM|143)',re.I)
for key in roles.values():
  logs=sorted(glob.glob(f'docs/delivery/test-evidence/DG4/{key}/round-10/**/*',recursive=True))
  logs=[l for l in logs if os.path.isfile(l) and re.search(r'\.(log|txt|md)$',l)]
  print(f'\n## {key}: {len(logs)} round-10 log/txt/md files (all scanned, cited or not)')
  for l in logs:
    hits=[ln for ln in open(l,errors='replace').read().splitlines() if pat.search(ln)]
    cited = l in allcited
    print(f' {l} cited={cited} flagged_lines={len(hits)}')
    for h in hits[:6]: print('    |',h.strip()[:220])
    if len(hits)>6: print('    | ...',len(hits)-6,'more')
