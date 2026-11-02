import re,sys,glob,os
pat=re.compile(r'([✓✘-])\s+\d+\s+\[(chromium-\w+)\]\s+›\s+apps/web/e2e/([\w-]+)\.spec\.ts:(\d+):\d+\s+›\s+(.*?)\s+\((\d+(?:\.\d+)?)(ms|s|m)\)')
E=sys.argv[1]
for log in sorted(glob.glob(f'{E}/verify-*.log')):
  name=os.path.basename(log)[7:-4]; spec=name.replace('.rerun','')
  txt=open(log,errors='replace').read()
  b=re.search(r'test\.setTimeout\((\d+)_000\)',open(f'apps/web/e2e/{spec}.spec.ts').read())
  w=(0,''); n=0; f=0
  for m in pat.finditer(txt):
    st,proj,s,ln,t,d,u=m.groups(); d=float(d)*{'ms':.001,'s':1,'m':60}[u]; n+=1; f+= st=='✘'
    if d>w[0]: w=(d,f'[{proj}] :{ln}')
  loads=[float(l.split()[2]) for l in open(log[:-4]+'.load') if l.startswith('[load')]
  rc=re.search(r'=== exit (\d+)',txt)
  print(f'{name:30} exit={rc.group(1) if rc else "?"} tests={n:2} failed={f} worst={w[0]:5.1f}s {w[1]:22} budget={b.group(1) if b else "per-test 60"}s load1m={min(loads):.0f}-{max(loads):.0f}')
