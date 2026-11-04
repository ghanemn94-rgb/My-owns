#!/usr/bin/env python3
"""T-DG6-FE-Z1B: from budget-table.txt, raise every budget below 2x its worst loaded duration (all logs, z1b included)
to max(60, 2x worst rounded up to 15 s), with a comment naming the measurement. Only the budget value changes.
usage: raise.py [dry|write]   (run from the repository root)"""
import re, sys, math, collections, os
SKIP = os.environ.get("RAISE_SKIP")  # regex of spec files still running in a live run; left for a later pass
E = "docs/delivery/handbacks/DG6/T-DG6-FE-Z1-evidence"
rows = []
for l in open(E + "/budget-table.txt", encoding="utf-8"):
    m = re.match(r"(\S+)\s+(\d+)\s+budget\s+([\d.]+)s (\S+)\s+max ([\d.]+)s n=\d+", l)
    if m: rows.append((m.group(1), int(m.group(2)), float(m.group(3)), m.group(4), float(m.group(5))))
need = lambda w: max(60, math.ceil(2 * w / 15) * 15)
plan = collections.defaultdict(lambda: [0, 0.0, None])  # (file, srcline) -> [new, worst, first test line]
for f, ln, b, src, w in rows:
    if 2 * w <= b or src == "default" or (SKIP and re.search(SKIP, f)): continue
    k = (f, int(src.split(":")[1])); p = plan[k]
    if w > p[1]: p[0], p[1], p[2] = need(w), w, ln
for (f, sl), (nb, w, tl) in sorted(plan.items(), key=lambda x: (x[0][0], -x[0][1])):
    src = open(f, encoding="utf-8").read().split("\n")
    line = src[sl - 1]; ind = re.match(r"^(\s*)", line).group(1)
    m = re.search(r"(setTimeout\((?:[^?]*\?\s*[0-9_]+\s*:\s*)?|timeout:\s*)([0-9_]+|[A-Z_]+)", line)
    tgt, old = sl, m.group(2) if m else None
    if old and re.match(r"[A-Z_]+$", old):  # a named constant
        tgt = next(i for i, l in enumerate(src, 1) if re.match(r"^\s*(?:export\s+)?const\s+%s\s*=" % old, l))
        line = src[tgt - 1]; ind = re.match(r"^(\s*)", line).group(1)
        m = re.search(r"(=\s*)([0-9_]+)", line)
    ob = int(m.group(2).replace("_", "")) // 1000
    if nb <= ob: continue
    print("%s:%d %ss -> %ss (worst %.1f s, test at line %d)" % (f, tgt, ob, nb, w, tl))
    if sys.argv[1:] == ["write"]:
        src[tgt - 1] = line[:m.start(2)] + "{:_}".format(nb * 1000) + line[m.end(2):]
        src[tgt - 1:tgt - 1] = [
            "%s// T-DG6-FE-Z1B: raised from %d s to %d s. In the z1b loaded full runs (load 21-26, above the review's 11-21;" % (ind, ob, nb),
            "%s// %s/z1b-*.log) the test in row :%d of z1b-budget-table-pass%s.txt took %.1f s; 2x rounded up to 15 s." % (ind, E, tl, os.environ.get("RAISE_PASS", "1"), w)]
        open(f, "w", encoding="utf-8").write("\n".join(src))
