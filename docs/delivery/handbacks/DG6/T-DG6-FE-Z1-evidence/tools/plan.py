#!/usr/bin/env python3
"""Budget plan from durations.py output (stdin). Rule (FE-Y1's, F-DG6-144): budget >= 2 x the worst loaded
duration (a 30 s timeout counts as >= its budget, so doubling it is a lower bound), rounded up to 15 s, never
below 60 s. Prints (a) the file-level budget for every file with tests on the default 30 s and (b) every
explicit budget under 2 x its measurement, with the proposed value."""
import re, sys, math, collections
rows = []
for l in sys.stdin:
    m = re.match(r"(\S+)\s+(\d+)\s+budget\s+([\d.-]+)s (\S+)\s+max (?:([\d.]+)s|\s*-\s*) n=(\d+)", l)
    if m:
        f, ln, b, src, mx, n = m.groups()
        rows.append((f, int(ln), float(b), src, float(mx) if mx else None))
def need(mx): return max(60, math.ceil(2 * mx / 15) * 15)
default = collections.defaultdict(list); explicit = []
for f, ln, b, src, mx in rows:
    if src == "default":
        default[f].append((ln, mx))
    elif mx is not None and 2 * mx > b:
        explicit.append((f, ln, b, src, mx, need(mx)))
print("== files with tests on the default 30 s: proposed file-level budget")
for f, ts in sorted(default.items()):
    ms = [m for _, m in ts if m is not None]
    w = max(ms) if ms else None
    print("%-50s tests=%d measured=%d worst=%s -> %ds" % (f, len(ts), len(ms), "%.1fs" % w if w else "-", need(w) if w else 60))
print("== explicit budgets under 2x their worst measurement")
for f, ln, b, src, mx, nb in explicit:
    print("%-50s test@%d %s %.0fs worst %.1fs -> %ds" % (f, ln, src, b, mx, nb))
