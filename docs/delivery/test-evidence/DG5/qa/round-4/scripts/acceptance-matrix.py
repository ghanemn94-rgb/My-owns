# qa-verifier DG5 r4: for each of the 78 DG5-final register rows, the test files its notes name, resolved against the
# candidate's tracked files and classified by where they run: unit (vitest unit-node / unit-web / nocodegen: run in
# this review), integration (vitest integration project: needs PostgreSQL) or e2e (Playwright on the real stack: needs
# PostgreSQL). A unit file counts as RUN-PASS only if the given unit log lists it with a pass mark.
# python3 -I acceptance-matrix.py <repo> <unit log>
import csv, re, subprocess, sys, json
repo, unit_log = sys.argv[1], sys.argv[2]
files = subprocess.run(["git", "-C", repo, "ls-files"], capture_output=True, text=True).stdout.split()
tests = [f for f in files if re.search(r"\.(test|spec)\.tsx?$", f) and not f.startswith("docs/")]
log = re.sub(r"\x1b\[[0-9;]*m", "", open(unit_log, encoding="utf8").read())
passed = set(re.findall(r"^ ✓ (?:\|[\w-]+\| )?(\S+\.test\.tsx?)", log, re.M))
def kind(p):
    if p.endswith(".spec.ts"): return "e2e"
    if "/test/integration/" in p or p.startswith("tests/qa/integration/"): return "integration"
    return "unit"
rows = [r for r in csv.DictReader(open(f"{repo}/docs/delivery/requirements.csv", encoding="utf8")) if r["final_gate"] == "DG5"]
out = []
for r in rows:
    text = r["notes"] + " " + r["evidence"]
    names = set(re.findall(r"[\w./-]+\.(?:test|spec)\.tsx?", text)) | {n + ".test.ts" for n in re.findall(r"\b(a\d\d-[\w-]+?)(?=[\s',;)]|$)", text)}
    res = {}
    for n in sorted(names):
        base = n.split("/")[-1]
        hits = [t for t in tests if t.endswith("/" + base) or t == n]
        for h in hits:
            k = kind(h)
            status = "RUN-PASS" if k == "unit" and any(h.endswith(p) or p.endswith(h.split("/", 2)[-1]) for p in passed) else ("RUN-?" if k == "unit" else "BLOCKED")
            res[h] = f"{k}:{status}"
    kinds = {v.split(":")[0] for v in res.values()}
    out.append({"req": r["req_id"], "acceptance_tags": r["acceptance"].split(":")[0], "tests": res,
                "unit_run_pass": sum(v == "unit:RUN-PASS" for v in res.values()),
                "blocked": sum(v.endswith("BLOCKED") for v in res.values()),
                "only_blocked_evidence": bool(res) and kinds <= {"integration", "e2e"}})
print(json.dumps(out, indent=1, ensure_ascii=False))
print("rows", len(out), "rows with any unit test run+passed", sum(o["unit_run_pass"] > 0 for o in out),
      "rows whose named evidence is only integration/e2e", sum(o["only_blocked_evidence"] for o in out),
      "rows naming no resolvable test", sum(not o["tests"] for o in out), file=sys.stderr)
