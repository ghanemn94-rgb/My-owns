import json,re,sys,glob,os,collections
mode=sys.argv[1]; R=os.environ['TMPDIR']+f'/ev/e2e-{mode}'; E='/home/user/My-owns/docs/delivery/test-evidence/DG3/qa'
r5mode={'unset':'unset','cutf8':'cutf8'}[mode]
def counts(log):
    c=collections.defaultdict(lambda:[0,0,0]); flaky=0
    for l in open(log,encoding='utf-8',errors='replace'):
        m=re.match(r'\s+(✓|✘|-)\s+\d+ \[(chromium-\w+)\] › (\S+?):\d+:\d+ ›',l)
        if not m: continue
        st,proj,spec=m.groups(); spec=re.sub(r'dg3-qa-r\d\.spec','dg3-qa-rN.spec',spec)
        c[(spec,proj)][{'✓':0,'✘':1,'-':2}[st]]+=1
    return c
old=counts(f'{E}/round-6/04-e2e-{r5mode}.log'); new=counts(f'{E}/round-7/04-e2e-{mode}.log')
out=[f"{'spec':48} {'proj':12} r6 pass/fail/skip  r7 pass/fail/skip"]
for k in sorted(set(old)|set(new)):
    o=old.get(k,[0,0,0]); n=new.get(k,[0,0,0])
    out.append(f"{k[0]:48} {k[1]:12} {'/'.join(map(str,o)):>10}         {'/'.join(map(str,n)):>10}{'' if o==n else '   <-- differs'}")
t=lambda c:[sum(v[i] for v in c.values()) for i in range(3)]
out.append(f"totals r6 {t(old)[0]} pass {t(old)[1]} fail {t(old)[2]} skip | r7 {t(new)[0]} pass {t(new)[1]} fail {t(new)[2]} skip")
log=open(f'{E}/round-7/04-e2e-{mode}.log',encoding='utf-8',errors='replace').read()
m=re.search(r'^\s+(\d+) passed.*$',log,re.M); out.append('playwright summary: '+' | '.join(x.strip() for x in re.findall(r'^\s+\d+ (?:passed|failed|flaky|skipped|did not run|interrupted).*$',log,re.M)))
open(f'{E}/round-7/04-per-spec-counts-r6-vs-r7-{mode}.txt','w').write('\n'.join(out)+'\n')
# checks
cs=[]
for lang in ['en','ar']:
    p=f'{R}/dg3-qa-r7-checks-{lang}.json'
    if not os.path.exists(p): cs.append(f'e2e-{mode} {lang}: checks file MISSING'); continue
    d=json.load(open(p)); o=json.load(open(f'{E}/round-6/results/e2e-{r5mode}-dg3-qa-r6-checks-{lang}.json'))
    rec=[x for x in d if x['req']!='info']; info=[x for x in d if x['req']=='info']
    fails=[x['id'] for x in rec if x['pass'] is not True]
    ids=set(x['id'] for x in rec); oids=set(x['id'] for x in o if x['req']!='info')
    norm=lambda s:{re.sub(r'R[56]','RN',i) for i in s}
    r4=[f"{x['id']}:{x['pass']}" for x in d if x['id'].startswith('A9-R4')]
    cs.append(f"e2e-{mode} {lang}: {len(rec)} recorded checks, {len(fails)} failed {fails}, {len(info)} info rows; ids only in r7 {sorted(norm(ids)-norm(oids))}, only in r6 {sorted(norm(oids)-norm(ids))}; A9-R4 repair checks {r4}")
open(f'{E}/round-7/04-checks-summary-{mode}.txt','w').write('\n'.join(cs)+'\n')
# axe
ax=[]
files=sorted(glob.glob(f'{R}/**/*axe-summary*.json',recursive=True))
pages=0; imp=collections.Counter(); bad=[]
for f in files:
    d=json.load(open(f))
    for page,v in d.items():
        pages+=1
        for vi in v.get('violations',[]):
            i=vi.get('impact') if isinstance(vi,dict) else str(vi); imp[i]+=1
            if i in('serious','critical'): bad.append((os.path.basename(f),page,vi.get('id') if isinstance(vi,dict) else vi))
qa=[]
for lang in ['en','ar']:
    p=f'{R}/dg3-qa-r7-checks-{lang}.json'
    if os.path.exists(p): qa+= [x for x in json.load(open(p)) if x['id'].startswith('UI-axe-')]
ax.append(f"e2e-{mode}: {len(files)} product axe summary files, {pages} pages, violations by impact {dict(imp)}, serious/critical {bad} | qa axe checks {len(qa)} failed {[x['id'] for x in qa if not x['pass']]}")
open(f'{E}/round-7/04-axe-summary-{mode}.txt','w').write('\n'.join(ax)+'\n')
# f180
fs=[]
for lang in ['en','ar']:
    a=f'{R}/f180-layout-{lang}.json'; b=f'{R}/f180b-layout-{lang}.json'
    if not (os.path.exists(a) and os.path.exists(b)): fs.append(f'e2e-{mode} {lang}: F180/F180b result MISSING'); continue
    A=json.load(open(a)); B=json.load(open(b))
    crit=lambda r: r['inside'] and r['clauseFound'] and r['clauseInside'] and r['notClipped'] and not r['overlaps'] and r['noHScroll'] and r['otherChipsNowrap'] and r['whiteSpace']!='nowrap'
    badr=[r for r in B if not crit(r)]
    states=sorted(set((r['width'],r['zoom200']) for r in badr))
    fs.append(f"e2e-{mode} {lang}: F180 {len(A)} badges, inside {sum(1 for r in A if r['inside'])}; F180b {len(B)} rows, failing {len(badr)} in states {states}; failing rows: inside={all(r['inside'] for r in badr)} notClipped={all(r['notClipped'] for r in badr)} overlaps={sum(len(r['overlaps']) for r in badr)} clauseInside={sum(1 for r in badr if r['clauseInside'])} noHScroll={sum(1 for r in badr if r['noHScroll'])} docScrollWidth={sorted(set(r['docScrollWidth'] for r in badr))}")
open(f'{E}/round-7/04-f180-summary-{mode}.txt','w').write('\n'.join(fs)+'\n')
print(open(f'{E}/round-7/04-per-spec-counts-r6-vs-r7-{mode}.txt').read()); print('\n'.join(cs)); print('\n'.join(ax)); print('\n'.join(fs))
