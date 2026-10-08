# qa-verifier DG3 round 7: per-line ESLint coverage of the static probe forms (from 01b-r7-rule-static-negative-probe.log).
import re,sys
log=open(sys.argv[1],encoding='utf-8').read(); out=[]
out.append("Per-line ESLint coverage of the probe forms, derived from 01b-r7-rule-static-negative-probe.log (lint errors per added line) and the scan's failure line.")
out.append("'declare const qaGen' is a helper declaration, not a probe form. The 'declare const qaP' type declaration is flagged by the round-6 name rule (then/catch/finally member names).")
for sec in re.split(r'^=+ ',log,flags=re.M)[1:]:
    head=sec.split('\n',1)[0]
    if not head.startswith('['): continue
    m=re.search(r'^@@ -\d+,\d+ \+(\d+),',sec,re.M); start=int(m.group(1))
    hunk=sec[m.end():].split('\n',1)[1].split('$ npx eslint')[0].split('\n')
    lno=start; added={}
    for l in hunk:
        if l.startswith('+'): added[lno]=l[1:]; lno+=1
        elif l.startswith(' '): lno+=1
    errs={}
    for e in re.finditer(r'^\s+(\d+):\d+\s+error\s+.*?\s{2,}(\S+)\s*$',sec,re.M): errs.setdefault(int(e.group(1)),[]).append(e.group(2))
    tot=re.search(r'(\d+) problems? \((\d+) errors?',sec); ex=re.search(r'\$ npx eslint.*?\nEXIT (\d+)',sec,re.S)
    out.append(f"\n== {head} (eslint: {tot.group(2) if tot else '?'} errors, EXIT {ex.group(1) if ex else '?'})")
    forms=refused=0; okflag=[]
    for n,t in added.items():
        nm=re.search(r'(?:function\*?|const|class)\s+(\w+)',t); name=nm.group(1) if nm else None
        if t.startswith('//') or not name: continue
        rules=sorted(set(errs.get(n,[])))
        if name.startswith('qaOK'): status='ALLOWED, not flagged' if not rules else 'ALLOWED SHAPE FLAGGED'; okflag+= [name] if rules else []
        elif t.startswith('declare'): status='REFUSED' if rules else 'not flagged'; name='declare const '+name
        else: forms+=1; refused+= bool(rules); status='REFUSED' if rules else 'NOT REFUSED'
        out.append(f"  line {n} {name:22} {status:22} {rules}")
    sc=re.search(r'→ (.*deeply equal.*)',sec)
    out.append(f"  forms refused by lint: {refused}/{forms}; allowed shapes flagged: {okflag}")
    out.append(f"  source scan (fuzz.test.ts): {'FAILS -> '+sc.group(1) if sc else 'did not fail'}")
open(sys.argv[2],'w').write('\n'.join(out)+'\n'); print('\n'.join(out))
