# qa-verifier DG5 r6: for each of the 78 DG5-final register rows, the test files its notes/evidence name, resolved
# against the candidate's tracked files, with their result in THIS round's logs:
#   unit        -> the vitest unit logs (02-unit-*.log): file line with a pass mark in every unit log given;
#   integration -> the integration logs (04-integration-*.log): file line "✓ |integration| <file>";
#   e2e         -> the Playwright logs (05-e2e-*.log): every test line of the spec, passed (✓) or failed (✘).
# A file counts PASS only if it was seen and never failed in the logs of its kind; FAIL if any log shows it failing;
# NOT-SEEN if no log lists it.
# python3 -I acceptance-matrix.py <repo> <evidence dir>
import csv, glob, json, re, subprocess, sys
repo, ev = sys.argv[1], sys.argv[2]
strip = lambda s: re.sub(r"\x1b\[[0-9;]*m", "", s)
files = subprocess.run(["git", "-C", repo, "ls-files"], capture_output=True, text=True).stdout.split()
tests = [f for f in files if re.search(r"\.(test|spec)\.tsx?$", f) and not f.startswith("docs/")]

def kind(p):
    if p.endswith(".spec.ts"): return "e2e"
    if "/test/integration/" in p or p.startswith("tests/qa/integration/"): return "integration"
    return "unit"

seen = {"unit": {}, "integration": {}, "e2e": {}}
def mark(k, f, ok):
    s = seen[k].setdefault(f, {"pass": 0, "fail": 0})
    s["pass" if ok else "fail"] += 1

for L in sorted(glob.glob(f"{ev}/02-unit-*.log")):
    if "samples" in L: continue
    for m in re.finditer(r"^ (✓|❯|×) \|[\w-]+\| (\S+\.test\.tsx?)", strip(open(L, encoding="utf8").read()), re.M):
        mark("unit", m.group(2), m.group(1) == "✓")
for L in sorted(glob.glob(f"{ev}/04-integration-*.log")):
    if "samples" in L: continue
    for m in re.finditer(r"^ (✓|❯|×) \|integration\| (\S+\.test\.ts)", strip(open(L, encoding="utf8").read()), re.M):
        mark("integration", m.group(2), m.group(1) == "✓")
for L in sorted(glob.glob(f"{ev}/05-e2e-*.log")):
    if "samples" in L: continue
    for m in re.finditer(r"^\s+(✓|✘|-)\s+\d+ \[chromium-(?:en|ar)\] › (\S+\.spec\.ts):", strip(open(L, encoding="utf8").read()), re.M):
        if m.group(1) != "-": mark("e2e", m.group(2).split("review-qa/")[-1], m.group(1) == "✓")

def status(k, path):
    for f, s in seen[k].items():
        if path.endswith(f) or f.endswith(path.split("/", 2)[-1] if k == "unit" else path):
            return ("FAIL" if s["fail"] else "PASS") + f"({s['pass']}/{s['pass'] + s['fail']})"
    return "NOT-SEEN"

rows = [r for r in csv.DictReader(open(f"{repo}/docs/delivery/requirements.csv", encoding="utf8")) if r["final_gate"] == "DG5"]
out = []
for r in rows:
    text = r["notes"] + " " + r["evidence"]
    names = set(re.findall(r"[\w./-]+\.(?:test|spec)\.tsx?", text)) | {n + ".test.ts" for n in re.findall(r"\b(a\d\d-[\w-]+?)(?=[\s',;)]|$)", text)}
    res = {}
    for n in sorted(names):
        base = n.split("/")[-1]
        for h in [t for t in tests if t.endswith("/" + base) or t == n]:
            res[h] = f"{kind(h)}:{status(kind(h), h)}"
    out.append({"req": r["req_id"], "acceptance": r["acceptance"].split(":")[0], "tests": res,
                "pass": sum(":PASS" in v for v in res.values()), "fail": sum(":FAIL" in v for v in res.values()),
                "not_seen": sum(v.endswith("NOT-SEEN") for v in res.values())})
print(json.dumps(out, indent=1, ensure_ascii=False))
print("rows", len(out), "| rows with >=1 named test passing in this round:", sum(o["pass"] > 0 for o in out),
      "| rows with a named test failing in some log:", [o["req"] for o in out if o["fail"]],
      "| rows naming no resolvable test:", [o["req"] for o in out if not o["tests"]], file=sys.stderr)
