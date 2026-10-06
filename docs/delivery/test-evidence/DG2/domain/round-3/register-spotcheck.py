import csv,re,sys,subprocess
paths=set(re.findall(r'^  (/api/v1/\S+):',open('docs/api/openapi.yaml').read(),re.M))
old={r['id'] if 'id' in r else list(r.values())[0]:r for r in csv.DictReader(subprocess.run(['git','show','eb8163e2:docs/delivery/requirements.csv'],capture_output=True,text=True).stdout.splitlines())}
rows=list(csv.DictReader(open('docs/delivery/requirements.csv')))
key=list(rows[0].keys())[0]
norm=lambda p: re.sub(r'\{[^}]+\}','{}',p.rstrip('/.,;)'))
P={norm(p) for p in paths}
changed=[r for r in rows if old.get(r[key],{}).get('screen_api')!=r['screen_api']]
print('changed rows:',len(changed))
bad=0
for r in changed:
  eps=re.findall(r'(?:GET|POST|PATCH|PUT|DELETE)?\s*(/api/v1/[^\s;,)]+|…/[^\s;,)]+)',r['screen_api'])
  res=[]
  for e in eps:
    if e.startswith('/api'):
      ok=norm(e) in P; res.append((e,ok)); bad+= (not ok)
    else: res.append((e,'relative'))
  print(r[key],'|',r['screen_api'][:300]); print('   ',res)
print('unresolved absolute paths:',bad)
