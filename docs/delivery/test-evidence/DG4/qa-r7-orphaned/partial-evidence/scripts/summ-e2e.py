#!/usr/bin/env python3
"""qa-verifier DG4 round 7: per-spec, per-project pass/fail/skip counts of a Playwright list-reporter log. argv[1] = log"""
import re, sys, collections
txt = re.sub(r"\x1b\[[0-9;]*m", "", open(sys.argv[1], encoding="utf-8", errors="replace").read())
pat = re.compile(r"^\s+(✓|✘|-|×)\s+\d+\s+\[(chromium-en|chromium-ar)\]\s+›\s+([^:]+):\d+:\d+\s+›\s+(.*?)(?:\s+\((\d+(?:\.\d+)?)(m?s)\))?$", re.M)
c = collections.defaultdict(lambda: collections.Counter())
slow, bad = [], []
for m in pat.finditer(txt):
    mark, proj, spec, title, t, u = m.groups()
    k = {"✓": "passed", "✘": "failed", "×": "failed", "-": "skipped"}[mark]
    c[(spec, proj)][k] += 1
    if t:
        secs = float(t) / (1000 if u == "ms" else 1)
        if u == "m": secs = float(t) * 60
        if secs >= 20: slow.append((secs, proj, spec, title[:120]))
    if k != "passed": bad.append((k, proj, spec, title[:200]))
tot = collections.Counter()
print(f"{'spec':60} {'project':12} passed failed skipped")
for (spec, proj), v in sorted(c.items()):
    tot.update(v)
    print(f"{spec:60} {proj:12} {v['passed']:6} {v['failed']:6} {v['skipped']:7}")
print(f"TOTAL passed={tot['passed']} failed={tot['failed']} skipped={tot['skipped']}")
summ = re.findall(r"^\s+(\d+) (passed|failed|flaky|skipped|did not run|interrupted).*$", txt, re.M)
print("playwright summary:", summ)
print("non-passed:"); [print("  ", *b) for b in bad]
print("tests >= 20 s:"); [print(f"   {s:6.1f}s {p} {sp} {ti}") for s, p, sp, ti in sorted(slow, reverse=True)]
