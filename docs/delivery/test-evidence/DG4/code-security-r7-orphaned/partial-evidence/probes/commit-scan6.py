# Reviewer probe (revision 6: openWrite counts only when its caller passes `atCommit: true`; it refreshes conditionally)
# (revision 5: a route's region also ends at the closing brace of its registering function, so the
# last route of a file no longer absorbs the rest of the file) (revision 4: generic functions and interface/type/class declarations end a region, so a function's
# body no longer bleeds into the next generic function) (revision 3: comments are stripped before analysis, because a call named in a doc comment made the
# revision-2 resolver report false coverage, e.g. workflows/gates.ts decideGate via a comment in register-kit.ts) (revision 2; replaces the coarse name closure of commit-scan.py): for every write route in the
# P4-touched API files, follow calls by name only to functions DEFINED IN THE SAME FILE or IMPORTED by name into it,
# up to depth 4, and report whether refreshPrincipal(…) or `atCommit: true` is reached. Residual routes are listed for
# manual reading.
import re,os,sys
root='apps/api/src/modules'
src={}
for d,_,fs in os.walk(root):
  for f in fs:
    if f.endswith('.ts') and '.test.' not in f:
      t=open(os.path.join(d,f)).read()
      t=re.sub(r'/\*[\s\S]*?\*/', lambda m: '\n'*m.group(0).count('\n'), t)
      t=re.sub(r'(^|[^:"\'`])//[^\n]*', r'\1', t)
      src[os.path.join(d,f)]=t
fn_re=re.compile(r'^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*(?:<[^\n]*?>)?\s*\(|^(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*(?::[^=\n]+)?=\s*(?:async\s*)?(?:<[^\n]*?>)?\s*\(|^(?:export\s+)?(?:interface|type|class|enum)\s+([A-Za-z0-9_]+)',re.M)
defs={}  # (file,name)->body
byname={}
for p,s in src.items():
  ms=list(fn_re.finditer(s))
  for i,m in enumerate(ms):
    n=m.group(1) or m.group(2) or ('__decl_'+m.group(3)); end=ms[i+1].start() if i+1<len(ms) else len(s)
    defs[(p,n)]=s[m.start():end]; byname.setdefault(n,[]).append(p)
call_re=re.compile(r'\b([A-Za-z0-9_]+)\s*\(')
imp_re=re.compile(r'import\s*\{([^}]*)\}\s*from\s*"(\.[^"]+)"',re.S)
def imported(p):
  out={}
  for m in imp_re.finditer(src[p]):
    base=os.path.normpath(os.path.join(os.path.dirname(p),m.group(2)))
    for name in m.group(1).split(','):
      name=name.strip().replace('type ','').split(' as ')[0].strip()
      if name: out[name]=base
  return out
def resolve(p,n):
  if (p,n) in defs: return [(p,n)]
  imp=imported(p)
  if n in imp:
    base=imp[n]
    # base is a file or a directory index; search the module directory's files for the definition
    d=base if os.path.isdir(base) else os.path.dirname(base)
    return [(q,n) for q in byname.get(n,[]) if q.startswith(d)]
  return []
memo={}
def reaches(p,body,depth,seen):
  if 'refreshPrincipal(' in body or 'atCommit: true' in body: return True
  if depth==0: return False
  for c in set(call_re.findall(body)):
    for key in resolve(p,c):
      # openWrite refreshes ONLY with options.atCommit; a caller that passes `atCommit: true` is matched textually above.
      if key[1]=='openWrite' and key[0].endswith('transformations/register-kit.ts'): continue
      if key in seen: continue
      seen.add(key)
      if reaches(key[0],defs[key],depth-1,seen): return True
  return False
files=[l.strip() for l in open(sys.argv[1]) if l.startswith('apps/api/src/modules')]
bad=[]; total=0
for p in files:
  if p not in src: continue
  s=src[p]
  for m in re.finditer(r'app\.(post|put|patch|delete)\(\s*([^,]+),',s):
    total+=1
    nxt=re.search(r'\n\s*app\.(get|post|put|patch|delete)\(|\n\}',s[m.end():])
    body=s[m.start(): m.end()+(nxt.start() if nxt else len(s)-m.end())]
    if reaches(p,body,5,set()): continue
    bad.append(f"{p}:{s[:m.start()].count(chr(10))+1} {m.group(1).upper()} {m.group(2).strip()}")
print(f"write routes scanned: {total}; no commit-time re-check reached within depth 5: {len(bad)}")
for b in bad: print('  '+b)
