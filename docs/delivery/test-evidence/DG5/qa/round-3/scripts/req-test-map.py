#!/usr/bin/env python3
# qa-verifier DG5 round 3: for each DG5-final requirement, the test files its register notes cite, and their result
# lines in THIS round's logs (02- unit, 04- integration, 05- e2e). A passed line is a vitest "✓" line or a Playwright "✓"
# line naming the file; a failed line STARTS with "×"/"✘"/"FAIL" and names the file (a "×" inside a test title, e.g.
# "class × state", is not a failure). Usage:
#   python3 -I req-test-map.py <requirements.csv> <round-3 evidence dir>
# Prints one block per requirement and, at the end, the cited files with NO result line in any log (missing).
import csv, glob, os, re, sys
reg, ev = sys.argv[1], sys.argv[2]
rows = [r for r in csv.DictReader(open(reg, encoding="utf-8")) if r["final_gate"] == "DG5"]
logs = {}
for p in sorted(glob.glob(os.path.join(ev, "0[245]-*.log"))):
    if p.endswith("-samples.log"): continue
    logs[os.path.basename(p)] = [re.sub(r"\x1b\[[0-9;]*m", "", l) for l in open(p, encoding="utf-8", errors="replace")]
CITE = re.compile(r"\b([A-Za-z0-9][A-Za-z0-9_.-]*\.(?:test|spec)\.tsx?|a\d\d[a-z]?-[a-z0-9-]+(?:\.test|\.spec)?)\b")
missing = set()
print(f"qa-verifier DG5 round 3: requirement -> cited tests -> result lines in this round's logs ({len(rows)} rows; logs: {len(logs)})\n")
for r in rows:
    cites = sorted(set(m.group(1) for m in CITE.finditer(r["notes"] + " " + r["evidence"])))
    print(f"{r['req_id']}  [{r['acceptance'][:110]}]")
    for c in cites:
        key = c if re.search(r"\.(test|spec)\.tsx?$", c) else c
        p = f = 0; where = []
        for name, lines in logs.items():
            hp = sum(1 for l in lines if key in l and re.match(r"^\s*✓", l))
            # a failure marker LEADS the line (vitest "×"/"FAIL", Playwright "✘"); a "×" inside a test title is not one
            hf = sum(1 for l in lines if key in l and re.match(r"^\s*(✘|×|FAIL\b)", l))
            if hp or hf: where.append(name)
            p += hp; f += hf
        if not where: missing.add(c)
        print(f"    {c}: passed-lines={p} failed-lines={f} in {where}")
    print()
print("cited names with no result line in any log of this round:", sorted(missing))
