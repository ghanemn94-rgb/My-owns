#!/usr/bin/env python3
"""qa-verifier DG4 round 9: per-run load bands (START/END markers), max sample gap, result lines, failure/timeout scan,
stderr lines, and margins on F-DG4-148's two classes (architecture.test.ts vs 30 s; raid 'action register' vs 5 s). Usage: <evidence dir>"""
import re,sys,statistics,datetime as dt,os
E=sys.argv[1]; strip=lambda s: re.sub(r'\x1b\[[0-9;]*m','',s)
def t(s): return dt.datetime.strptime(s,'%H:%M:%S')
for ser in ('-r1','-r2'):
    S=open(f'{E}/02-unit-envelope-samples{ser}.log').read().splitlines()
    samples=[(t(l.split()[0]),float(l.split()[1])) for l in S if len(l.split())==4 and l.split()[1][0].isdigit()]
    gaps=[(b[0]-a[0]).seconds for a,b in zip(samples,samples[1:])]
    v=[x for _,x in samples]
    print(f'== series {ser}: n={len(v)} min={min(v):.2f} median={statistics.median(v):.2f} max={max(v):.2f} above8={sum(x>8 for x in v)} max_gap_s={max(gaps)}')
    cur=None
    for l in S:
        p=l.split()
        if len(p)>=3 and p[1]=='START': cur=(p[2],p[3],t(p[0]))
        if len(p)>=3 and p[1]=='END' and cur:
            band=[x for (ts,x) in samples if cur[2]<=ts<=t(p[0])]
            L=f'{E}/02-unit-{cur[0]}-{cur[1]}{ser}.log'; txt=strip(open(L).read()); lines=txt.splitlines()
            res=[x.strip() for x in lines if re.match(r'^ +(Tests|Test Files) ',x)]
            ex=[x for x in lines if x.startswith('EXIT')]
            fail=[x for x in lines if re.search(r'\bFAIL\b| failed|Timed out|timed out',x)]
            arch=re.findall(r'architecture\.test\.ts[^\n]*?(\d+)ms',txt)
            raid=[x for x in lines if 'action register' in x]
            dup=sum('Encountered two children with the same key' in x for x in lines)
            print(f'  {cur[0]} {cur[1]}: {cur[2].time()}-{p[0]} load {min(band):.2f}-{max(band):.2f} (n={len(band)}) | {" | ".join(res)} | {ex} | fail/timeout lines: {len(fail)} | duplicate-key warnings: {dup}')
            for f in fail[:6]: print('     FAILLINE:',f.strip()[:200])
            print('     architecture.test.ts ms:',arch[:3],' raid action register:',[x.strip()[:120] for x in raid[:2]])
            cur=None
