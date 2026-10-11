#!/usr/bin/env python3
"""qa-verifier DG4 round 1: requirement -> test trace. For each of the 137 DG4-final rows of docs/delivery/requirements.csv,
every evidence path that is a test file is looked up in THIS review's logs (unit node24-unset, integration run1 and run2,
e2e unset and cutf8) and its passed/failed counts are reported. Usage: trace.py <repo> <evidence-dir>"""
import csv, re, sys, collections, os
repo, ev = sys.argv[1], sys.argv[2]
strip = lambda s: re.sub(r"\x1b\[[0-9;]*m", "", s)
def load(name):
    p = os.path.join(ev, name)
    return strip(open(p, encoding="utf-8", errors="replace").read()) if os.path.exists(p) else ""
logs = {
    "unit": load("02-unit-node24-unset.log"),
    "int1": load("03-integration-run1.log"),
    "int2": load("03-integration-run2.log"),
    "e2e-unset": load("04-e2e-full-unset.log"),
    "e2e-cutf8": load("04-e2e-full-cutf8.log"),
}
def counts(path):
    out = {}
    # vitest verbose (integration): " ✓ |integration| path > ..."; unit default reporter: " ✓ |unit-node| path (N tests)" or "✓ path"
    for k in ("int1", "int2"):
        t = logs[k]
        p = len(re.findall(r"^ ✓ \|integration\| " + re.escape(path) + r" ", t, re.M))
        f = len(re.findall(r"^ × \|integration\| " + re.escape(path) + r" ", t, re.M))
        if p or f: out[k] = (p, f)
    t = logs["unit"]
    m = re.search(r"^ (✓|❯|×) +(?:unit-node|unit-web|unit-formula-nocodegen) +" + re.escape(path.replace("apps/web/", "")) + r" \((\d+) tests?(?: \| (\d+) (?:failed|skipped))?", t, re.M)
    if m: out["unit"] = (int(m.group(2)) - int(m.group(3) or 0), 0 if m.group(1) == "✓" else int(m.group(3) or 1))
    for k in ("e2e-unset", "e2e-cutf8"):
        t = logs[k]
        p = len(re.findall(r"^\s+✓\s+\d+\s+\[chromium-(?:en|ar)\]\s+›\s+" + re.escape(path) + r":", t, re.M))
        f = len(re.findall(r"^\s+(?:✘|×)\s+\d+\s+\[chromium-(?:en|ar)\]\s+›\s+" + re.escape(path) + r":", t, re.M))
        if p or f: out[k] = (p, f)
    return out
rows = [r for r in csv.DictReader(open(os.path.join(repo, "docs/delivery/requirements.csv"), encoding="utf-8")) if r["final_gate"] == "DG4"]
print(f"rows: {len(rows)}")
nofail = 0
for r in rows:
    tests = [p for p in r["evidence"].split(";") if re.search(r"\.(test|spec)\.tsx?$", p)]
    res = {p: counts(p) for p in tests}
    ran = {p: c for p, c in res.items() if c}
    failed = sum(f for c in ran.values() for (_, f) in c.values())
    if ran and not failed: nofail += 1
    print(f"{r['req_id']}: status={r['status']} evidence_tests={len(tests)} found_in_logs={len(ran)} failed={failed}")
    for p, c in res.items():
        print(f"    {p}: " + (", ".join(f"{k} {v[0]} passed/{v[1]} failed" for k, v in c.items()) if c else "NOT FOUND in this review's logs"))
print(f"rows with >=1 evidence test found in the logs and none failed: {nofail}/{len(rows)}")
