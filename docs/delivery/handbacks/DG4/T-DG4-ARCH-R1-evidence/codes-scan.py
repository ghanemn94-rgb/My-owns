import re,glob,subprocess,sys
adr=''.join(open(f).read() for f in glob.glob('docs/architecture/adr/*.md'))
old=set(l.strip().strip('"') for l in open(sys.argv[1]))
files=[f for f in subprocess.check_output(['git','ls-files','apps/api/src','apps/worker/src','packages/shared/src']).decode().split() if f.endswith('.ts') and '.test.' not in f]
lit=re.compile(r'"([a-z][a-z0-9_]*\.[a-z0-9_.]+)"')
perm=set()
try:
    perm=set(re.findall(r'"([a-z_]+\.[a-z_]+)"',open('packages/shared/src/permissions.ts').read()))
except: pass
found={}
for f in files:
    for i,line in enumerate(open(f)):
        for m in lit.finditer(line):
            c=m.group(1)
            if c in old or c in perm: continue
            if re.search(r'(?<![a-z0-9_.])'+re.escape(c)+r'(?![a-z0-9_])',adr): continue
            if re.search(r'action:|\.ts"|\.js"|eventType|EVENT|recordType|import |from "',line): continue
            found.setdefault(c,[]).append(f"{f.replace('apps/api/src/modules/','api:').replace('apps/worker/src/','worker:')}:{i+1}: {line.strip()[:150]}")
for c in sorted(found):
    print(c); [print('   ',x) for x in found[c][:3]]
