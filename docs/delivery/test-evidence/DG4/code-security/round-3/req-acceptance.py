# code-security-reviewer DG4 round-3 (copied from rounds 1-2, unchanged logic): per-requirement evidence check. For each of the 52 assigned requirements, every
# vitest file named in its register `evidence` column is looked up in THIS round's logs (unit Node 22 + Node 24 rerun,
# integration run 1 and run 2): passed (✓), failed (×) and skipped (↓) test counts per file and log. Playwright specs
# (e2e/**, apps/web/e2e/**) are not run by this reviewer (QA's e2e run) and are listed as "e2e: not run here".
import csv,re,sys,os
EV=os.path.dirname(os.path.abspath(__file__))
REQ="REQ-PB-013 REQ-PB-015 REQ-PB-082 REQ-PB-083 REQ-PB-085 REQ-S03-001 REQ-S03-008 REQ-S04-002 REQ-S04-009 REQ-S04-010 REQ-S04-014 REQ-S07-003 REQ-S07-009 REQ-S07-013 REQ-S07-015 REQ-S08-004 REQ-S08-006 REQ-S08-015 REQ-S08-017 REQ-S09-010 REQ-S10-003 REQ-S10-005 REQ-S10-006 REQ-S10-007 REQ-S10-008 REQ-S10-009 REQ-S10-010 REQ-S10-011 REQ-S10-012 REQ-S10-014 REQ-S10-016 REQ-S10-017 REQ-S10-018 REQ-S10-019 REQ-S11-005 REQ-S11-009 REQ-S12-005 REQ-S12-006 REQ-S12-009 REQ-S12-010 REQ-S12-011 REQ-S12-014 REQ-S12-016 REQ-S13-001 REQ-S16-005 REQ-S16-011 REQ-S16-014 REQ-S16-017 REQ-S16-018 REQ-S16-019 REQ-S16-020 REQ-S16-025".split()
rows={r['req_id']:r for r in csv.DictReader(open('/home/user/My-owns/docs/delivery/requirements.csv'))}
logs={n:open(os.path.join(EV,n),errors='replace').read().splitlines() for n in sys.argv[1:]}
bad=0
for q in REQ:
  r=rows[q]
  files=[f for f in r['evidence'].split(';') if re.search(r'\.(test|spec)\.tsx?$',f)]
  print(f"{q} [{r['status']}, final {r['final_gate']}]")
  for f in files:
    if f.startswith('e2e/') or '/e2e/' in f:
      print(f"   e2e: not run here  {f}"); continue
    parts=[]
    alt=f[len('apps/web/'):] if f.startswith('apps/web/') else f
    for n,lines in logs.items():
      per=[l for l in lines if (f in l or ' '+alt+' >' in l) and ' > ' in l]
      p=sum(1 for l in per if re.match(r'\s*✓',l)); x=sum(1 for l in per if re.match(r'\s*(×|✗)',l)); s=sum(1 for l in per if re.match(r'\s*↓',l))
      if not per:
        for l in lines:
          m=re.match(r'\s*(✓|❯|×)\s+\|[a-z-]+\|\s+(\S+)\s+\((\d+) tests?(?: \| (\d+) failed)?',l)
          if m and (m.group(2)==alt or m.group(2)==f):
            fl=int(m.group(4) or 0); p+=int(m.group(3))-fl; x+=fl
      if p or x or s: parts.append(f"{n}: {p} passed/{x} failed/{s} skipped")
      if x: bad+=1
    print(f"   {f}: " + ("; ".join(parts) if parts else "NOT FOUND in this round's logs"))
print(f"files with a failure: {bad}")
