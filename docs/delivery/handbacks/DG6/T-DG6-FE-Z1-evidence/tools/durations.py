#!/usr/bin/env python3
"""Per-test durations from Playwright list-reporter logs, joined with each test's effective budget.

usage: durations.py LOG [LOG ...]   (run from the repository root)
Prints one line per test (spec:line): effective budget (source), max duration seen, status, ratio.
A test that ended in "Test timeout of N ms exceeded" counts as >= N (a lower bound).
"""
import re, sys, os, collections, glob

LINE = re.compile(r"^\s+(✓|✘|-)\s+\d+ \[(chromium-\w+)\] › ((?:apps/web/)?e2e/[\w./-]+\.spec\.ts):(\d+):\d+ › (.*?)(?: \((\d+(?:\.\d+)?)(ms|s|m)\))?\s*$")
def norm(t):
    return re.sub(r"\s+", " ", t).strip()  # T-DG6-FE-Z1B: untruncated, so describe-prefixed titles match

def secs(v, u):
    v = float(v); return v / 1000 if u == "ms" else v * 60 if u == "m" else v

dur = collections.defaultdict(list)   # (file, line) -> [(secs, status, log, project)]
title = {}
for log in sys.argv[1:]:
    for l in open(log, encoding="utf-8", errors="replace"):
        m = LINE.match(l)
        if not m or not m.group(6):
            continue
        st, proj, f, ln, t, v, u = m.groups()
        key = (f, norm(t)); title[key] = t[:70]
        dur[key].append((secs(v, u), {"✓": "pass", "✘": "FAIL", "-": "skip"}[st], os.path.basename(log), proj))

def num(expr, consts):
    expr = re.sub(r"(?<=\d)_(?=\d)", "", expr.strip())
    for k, v in consts.items():
        expr = re.sub(r"\b%s\b" % k, str(v), expr)
    try:
        return eval(expr, {"__builtins__": {}}) / 1000
    except Exception:
        return None

TEST = re.compile(r"^\s*test(?:\.(?:only|fixme|skip))?\(\s*([`\"'])(.*)")
def budgets(path):
    src = open(path, encoding="utf-8").read().split("\n")
    consts = {}
    for l in src:
        m = re.match(r"^\s*(?:export\s+)?const\s+([A-Z_][A-Z0-9_]*)\s*=\s*([0-9_ +*()A-Z]+);", l)
        if m:
            v = num(m.group(2), consts)
            if v is not None:
                consts[m.group(1)] = v * 1000
    file_budget, file_src = 30.0, "default"
    tests = []
    for i, l in enumerate(src, 1):
        m = re.match(r"^test\.setTimeout\((.*)\);", l)
        if m: file_budget, file_src = num(m.group(1), consts), "file:%d" % i
        m = re.match(r"^test\.describe\.configure\(.*timeout:\s*([0-9_]+)", l)
        if m: file_budget, file_src = num(m.group(1), consts), "configure:%d" % i
        m = TEST.match(l)
        if m:
            q, rest = m.group(1), m.group(2)
            if q not in rest and i < len(src):
                rest += " " + src[i].strip()
            t = rest.split(q)[0] if q in rest else rest
            tests.append((i, t))
    out = {}
    for j, (start, t) in enumerate(tests):
        end = tests[j + 1][0] if j + 1 < len(tests) else len(src)
        b, s = file_budget, file_src
        for k in range(start, end):
            m = re.match(r"^\s+test\.setTimeout\((?:[^?]*\?\s*[0-9_]+\s*:)?(.*?)\);", src[k - 1])
            if m:
                b, s = num(m.group(1), consts), "test:%d" % k
                break
        out[start] = (b, s, t)
    return out

def matches(logt, srct):
    srct = norm(srct.replace("\\'", "'"))
    if "${" in srct:
        pre = srct.split("${")[0][:40]
        return len(pre) > 5 and (logt.startswith(pre) or (" › " + pre) in logt)
    return logt[:50] == srct[:50] or (" › " + srct[:50]) in logt

specs = sorted(glob.glob("apps/web/e2e/*.spec.ts") + glob.glob("e2e/*.spec.ts"))
for f in specs:
    for ln, (b, s, t) in sorted(budgets(f).items()):
        d = [x for k, v in dur.items() if k[0] == f and matches(k[1], t) for x in v]
        mx = max((x[0] for x in d if x[1] != "skip"), default=None)
        fails = sum(1 for x in d if x[1] == "FAIL")
        flag = ""
        if mx is not None and b is not None and (mx * 2 > b or fails):
            flag = "  <-- UNDER 2x" + (" (%d FAIL)" % fails if fails else "")
        mine = [x[0] for x in d if x[1] != "skip" and x[2].startswith(("run", "rerun", "z1b"))]
        tos = sum(1 for x in d if x[1] == "FAIL" and x[2].startswith(("run", "rerun", "z1b")))
        print("%-52s %5d  budget %6.1fs %-14s max %s n=%d%s | FE-Z1 max %s n=%d fails=%d" % (f, ln, b or -1, s, "%.1fs" % mx if mx is not None else "  -  ", len(d), flag,
              "%.1fs" % max(mine) if mine else "-", len(mine), tos))
