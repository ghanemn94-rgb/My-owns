# usage: budget.py <evidence-dir> [--apply] ; reads measure-<spec>.log/.load, prints the table, optionally edits specs
import re,sys,os,math,glob
E=sys.argv[1]; apply='--apply' in sys.argv
ROOT='/home/user/wt/dg6-fe-y1'
pat=re.compile(r'([✓✘-])\s+\d+\s+\[(chromium-\w+)\]\s+›\s+apps/web/e2e/([\w-]+)\.spec\.ts:(\d+):\d+\s+›\s+(.*?)\s+\((\d+(?:\.\d+)?)(m?s|m)\)')
rows=[]
REV={'journeys':(36.5,1),'p2-blank-text':(23.3,0),'p3-business-cases':(33.1,1),'p3-inherited-approval':(22.7,0),'p3-portfolio':(32.2,1),'p3-seams':(35.9,1),'p4-adoption-bau':(30.9,1),'p4-execution':(35.1,1),'p4-governance':(33.1,1),'p4-kpi':(35.2,1),'p4-route-splitting':(32.2,1),'p4-traceability':(32.2,1),'p4-value-headlines':(31.8,1),'p5-reader-branding-demo':(31.5,1),'p5-shell':(24.0,0),'p6-shell':(5.4,0),'session-end':(19.5,0)}
for log in sorted(glob.glob(f'{E}/measure-*.log')):
  spec=os.path.basename(log)[8:-4]
  txt=open(log,errors='replace').read()
  worst=(0,None); n=0; fails=0
  for m in pat.finditer(txt):
    st,proj,s,ln,title,d,u=m.groups()
    d=float(d)*{'ms':0.001,'s':1,'m':60}[u]; n+=1
    if st=='✘': fails+=1
    if d>worst[0]: worst=(d,f'[{proj}] :{ln} {title}')
  loads=[float(l.split()[2]) for l in open(log[:-4]+'.load') if l.startswith('[load')]
  rc=re.search(r'=== exit (\d+)',txt)
  rv=REV[spec]; basis=max(worst[0],rv[0])
  budget=max(60, math.ceil(2*basis/15)*15)
  rows.append((spec,n,fails,rc.group(1) if rc else '?',worst,min(loads) if loads else 0,max(loads) if loads else 0,budget,rv))
for r in rows:
  print(f'{r[0]:26} tests={r[1]:3} fails={r[2]} exit={r[3]} worst={r[4][0]:6.1f}s load1m={r[5]:.1f}-{r[6]:.1f} review={r[8][0]}s{"(timeout)" if r[8][1] else ""} budget={r[7]}s  {r[4][1]}')
if apply:
  for spec,n,fails,rc,worst,lo,hi,budget,rv in rows:
    if rc!='0' or n==0: print('SKIP',spec); continue
    p=f'{ROOT}/apps/web/e2e/{spec}.spec.ts'; s=open(p).read()
    if 'F-DG6-144' in s: print('already',spec); continue
    title=worst[1]
    if len(title)>70: title=title[:67]+'...'
    revtxt=(f'its slowest test timed out at the default 30 s ({rv[0]:.1f} s reported), so at least that long' if rv[1] else f'its slowest test took {rv[0]:.1f} s')
    block=(f'// Budget (F-DG6-144, the F-DG5-145/146 carry-forward of D-193; p6-work-split §2 rules 13 and 15): {budget} s per test.\n'
           f'// Measured: run alone, both language projects, at a 1-minute load of {lo:.0f}-{hi:.0f} on 4 CPUs (three e2e stacks in\n'
           f'// parallel), the slowest test took {worst[0]:.1f} s ({title})\n'
           f'// (docs/delivery/handbacks/DG6/T-DG6-FE-Y1-evidence/f144/measure-{spec}.log). In the DG6 QA round-1 full runs\n'
           f'// (docs/delivery/test-evidence/DG6/qa/round-1/06-e2e-product-*.log), {revtxt}.\n'
           f'// The budget is at least 2x the larger of the two, rounded up to 15 s, and never below 60 s.\n'
           f'test.setTimeout({budget}_000);\n')
    lines=s.split('\n')
    # after `test.describe.configure(...)` if any at top level, else after the last top-level import statement
    idx=None
    for i,l in enumerate(lines):
      if l.startswith('test.describe.configure('): idx=i+1; break
    if idx is None:
      last=None; inimp=False
      for i,l in enumerate(lines):
        if l.startswith('import '): inimp=True
        if inimp and (l.rstrip().endswith(';')): last=i; inimp=False
      idx=last+1
    lines[idx:idx]=['']+block.rstrip('\n').split('\n')
    open(p,'w').write('\n'.join(lines)); print('applied',spec,budget)
