#!/usr/bin/env python3
# qa-verifier, DG0 round 25 (T-DG0-REV-QA-R25): independent register integrity check. Author: qa-verifier.
# Python stdlib only (a different language/parser from the round-1 node script and from tools/gates). Exits 1 on any error.
# Usage: python3 -I -B register-integrity-r25.py <repo-root>
import csv, json, os, re, subprocess, sys
from collections import Counter

root = sys.argv[1]
P = lambda *a: os.path.join(root, *a)
errors, notes = [], []
COLS = ["req_id", "class", "title", "source_ref", "source_heading", "template_id", "input_fields", "procedure", "output",
        "owner_roles", "permissions", "automation", "screen_api", "acceptance", "increments", "final_gate", "status", "evidence", "notes"]
ASSIGNED = ["REQ-DLV-%03d" % n for n in (1, 2, 3, 4, 6, 7, 13, 15, 16, 17, 19, 20, 22, 23, 26, 29, 32)] + ["REQ-S20-024", "REQ-S20-025"]

raw = open(P("docs/delivery/requirements.csv"), encoding="utf-8", newline="").read()
if raw.startswith("﻿"): errors.append("BOM present")
rows = list(csv.reader(raw.splitlines(True) and __import__("io").StringIO(raw)))
if rows[0] != COLS: errors.append("header mismatch: %s" % rows[0])
data = rows[1:]
ids = Counter(r[0] for r in data)
for i, r in enumerate(data, 2):
    if len(r) != len(COLS): errors.append("line %d %s: %d columns (expected %d)" % (i, r[0] if r else "?", len(r), len(COLS))); continue
    d = dict(zip(COLS, r))
    for c in ("req_id", "class", "title", "source_ref", "procedure", "output", "owner_roles", "acceptance", "increments", "final_gate", "status"):
        if not d[c].strip(): errors.append("%s: empty %s" % (d["req_id"], c))
    if not re.fullmatch(r"REQ-[A-Z0-9]+-\d{3}", d["req_id"]): errors.append("%s: bad id" % d["req_id"])
    if d["class"] not in ("SOURCE", "USER", "ENGINEERING"): errors.append("%s: class %s" % (d["req_id"], d["class"]))
    if d["status"] == "VERIFIED": errors.append("%s: status VERIFIED (no engineering agent may self-verify)" % d["req_id"])
    if d["status"] not in ("SPECIFIED", "IMPLEMENTED"): errors.append("%s: status %s" % (d["req_id"], d["status"]))
    inc = d["increments"].split(";")
    if any(not re.fullmatch(r"P[0-7]", x) for x in inc): errors.append("%s: increments %s" % (d["req_id"], d["increments"]))
    elif not re.fullmatch(r"DG[0-7]", d["final_gate"]): errors.append("%s: final_gate %s" % (d["req_id"], d["final_gate"]))
    else:
        last = max(int(x[1]) for x in inc)
        if int(d["final_gate"][2]) != last: errors.append("%s: final_gate %s != last increment P%d" % (d["req_id"], d["final_gate"], last))
        if inc != sorted(set(inc)): errors.append("%s: increments not sorted/unique %s" % (d["req_id"], d["increments"]))
    if d["status"] == "IMPLEMENTED":
        if d["final_gate"] != "DG0": errors.append("%s: IMPLEMENTED but final_gate %s" % (d["req_id"], d["final_gate"]))
        ev = [e for e in d["evidence"].split(";") if e]
        if not ev: errors.append("%s: IMPLEMENTED without evidence" % d["req_id"])
        for e in ev:
            if not os.path.isfile(P(e)): errors.append("%s: evidence %s missing" % (d["req_id"], e))
            elif subprocess.run(["git", "-C", root, "ls-files", "--error-unmatch", e], capture_output=True).returncode: errors.append("%s: evidence %s untracked" % (d["req_id"], e))
    elif d["evidence"].strip():
        notes.append("%s: SPECIFIED with evidence listed (%s)" % (d["req_id"], d["evidence"][:80]))
dups = [k for k, v in ids.items() if v > 1]
if dups: errors.append("duplicate ids: %s" % dups)
by = {r[0]: dict(zip(COLS, r)) for r in data if len(r) == len(COLS)}
dg0 = sorted(k for k, d in by.items() if d["final_gate"] == "DG0")
impl = sorted(k for k, d in by.items() if d["status"] == "IMPLEMENTED")
if dg0 != sorted(ASSIGNED): errors.append("DG0-final set %s != assigned %s" % (dg0, sorted(ASSIGNED)))
if impl != dg0: errors.append("IMPLEMENTED set != DG0-final set: %s" % sorted(set(impl) ^ set(dg0)))

# ---- does each IMPLEMENTED row's evidence actually implement it? a content anchor per requirement (hand-chosen by qa)
ANCHOR = {
    "REQ-DLV-001": [("docs/delivery/decisions.md", r"D-0\d\d"), ("docs/delivery/environment.md", r"(?i)node")],
    "REQ-DLV-002": [("tools/gates/schemas/gate.schema.json", r"candidate_id"), ("docs/delivery/agent-protocol.md", r"G1.G6")],
    "REQ-DLV-003": [("docs/delivery/environment.md", r"(?i)sandbox|bubblewrap")],
    "REQ-DLV-004": [(".claude/agents/qa-verifier.md", r"name:\s*qa-verifier"), (".claude/agents/release-auditor.md", r"name:\s*release-auditor")],
    "REQ-DLV-006": [("tools/agents/run-agent.sh", r"--agent"), ("tools/agents/run-agent.sh", r"session")],
    "REQ-DLV-007": [("tools/agents/guard-write.mjs", r"write-scopes"), ("tools/agents/write-scopes.json", r"qa-verifier")],
    "REQ-DLV-013": [("tools/gates/schemas/review.schema.json", r"independence_declaration"), ("tools/gates/lib/rules.mjs", r"export function checkInvocation")],
    "REQ-DLV-015": [("tools/gates/schemas/stages.schema.json", r"VERIFYING"), ("tools/gates/lib/rules.mjs", r"APPROVED")],
    "REQ-DLV-016": [("tools/gates/lib/rules.mjs", r"export function validateGate"), ("tools/gates/validate.mjs", r"process\.exit"), ("tools/gates/lib/rules.mjs", r"is not in the verified \$\{v\.roundDir\} candidate")],
    "REQ-DLV-017": [("tools/gates/schemas/findings.schema.json", r"mandatory_violation"), ("tools/gates/import-findings.mjs", r"verifications")],
    "REQ-DLV-019": [("CLAUDE.md", r"progress\.md"), ("docs/delivery/decisions.md", r"D-041")],
    "REQ-DLV-020": [("tools/source/merge_register.py", r"requirements\.csv"), ("tools/gates/lib/rules.mjs", r"(?i)register")],
    "REQ-DLV-022": [("tools/gates/lib/candidate.mjs", r"sha256"), ("tools/gates/lib/candidate.mjs", r"META_EXCLUDES")],
    "REQ-DLV-023": [(".github/workflows/delivery-gates.yml", r"validate\.mjs"), (".github/workflows/delivery-gates.yml", r"fetch-depth:\s*0")],
    "REQ-DLV-026": [("tools/agents/run_meta.py", r"transcript"), ("tools/agents/run-agent.sh", r"meta\.json")],
    "REQ-DLV-029": [("tools/gates/validate.mjs", r"--reconcile"), ("docs/delivery/progress.md", r"(?i)next")],
    "REQ-DLV-032": [("docs/source/playbook.md", r"B0165"), ("docs/source/master-prompt.anchored.md", r"M0423"), ("docs/analysis/stage-plan.md", r"DG7")],
    "REQ-S20-024": [("tools/gates/tests/validator.test.mjs", r"(?i)A24|advance"), ("tools/gates/lib/rules.mjs", r"(?i)depends_on|preceding|previous")],
    "REQ-S20-025": [("tools/gates/tests/validator.test.mjs", r"(?i)A25|candidate"), ("tools/gates/lib/candidate.mjs", r"export function candidateId")],
}
anchor_lines = []
for rid in ASSIGNED:
    evs = set(by.get(rid, {}).get("evidence", "").split(";"))
    for path, rx in ANCHOR[rid]:
        inev = path in evs
        hit = os.path.isfile(P(path)) and re.search(rx, open(P(path), encoding="utf-8", errors="replace").read()) is not None
        anchor_lines.append("%s  %-45s /%s/  in-evidence=%s  match=%s" % (rid, path, rx, inev, hit))
        if not hit: errors.append("%s: anchor /%s/ not found in %s" % (rid, rx, path))

# ---- A01-A28: one REQ-S20-0NN row per scenario; each scenario cited by other rows' acceptance; acceptance-map lists it
amap = open(P("docs/analysis/acceptance-map.md"), encoding="utf-8").read()
for n in range(1, 29):
    a, rid = "A%02d" % n, "REQ-S20-%03d" % n
    if rid not in by: errors.append("%s: no test row %s" % (a, rid)); continue
    if not re.search(r"\b%s\b" % a, by[rid]["title"]): errors.append("%s: %s title does not name it" % (a, rid))
    citing = [k for k, d in by.items() if k != rid and re.search(r"\b%s\b" % a, d["acceptance"])]
    if not citing: errors.append("%s: no requirement cites it in acceptance" % a)
    if not re.search(r"\b%s\b" % a, amap): errors.append("%s: missing from acceptance-map.md" % a)
    for k in citing:
        if int(by[k]["final_gate"][2]) > int(by[rid]["final_gate"][2]) and k not in amap:
            errors.append("%s: citing row %s finishes after the scenario gate but is not annotated in the map" % (a, k))

# ---- coverage matrices
def cov(path, prefix, n):
    rs = list(csv.DictReader(open(P(path), encoding="utf-8", newline="")))
    got = [r["block_id"] for r in rs]
    want = ["%s%04d" % (prefix, i) for i in range(1, n + 1)]
    if got != want: errors.append("%s: block ids are not exactly %s0001..%s%04d in order" % (path, prefix, prefix, n))
    c = Counter(r["disposition"] for r in rs)
    for r in rs:
        reqs = [x for x in re.split(r"[;, ]+", r["req_ids"]) if x]
        if r["disposition"] == "REQUIREMENT" and not reqs: errors.append("%s %s: REQUIREMENT without req_ids" % (path, r["block_id"]))
        if r["disposition"] != "REQUIREMENT" and not r["rationale"].strip(): errors.append("%s %s: %s without rationale" % (path, r["block_id"], r["disposition"]))
        for x in reqs:
            if x not in by: errors.append("%s %s: cites unknown %s" % (path, r["block_id"], x))
    return len(rs), dict(c)
sc = cov("docs/analysis/source-coverage.csv", "B", 165)
mc = cov("docs/analysis/master-prompt-coverage.csv", "M", 423)
src_blocks = json.load(open(P("docs/source/playbook.blocks.json")))
mp_blocks = json.load(open(P("docs/source/master-prompt.blocks.json")))
if len(src_blocks) != 165 or len(mp_blocks) != 423: errors.append("source block counts %d/%d" % (len(src_blocks), len(mp_blocks)))
# every SOURCE row cites a playbook block, and that block maps back to it
pbmap = {r["block_id"]: r["req_ids"] for r in csv.DictReader(open(P("docs/analysis/source-coverage.csv"), encoding="utf-8"))}
for k, d in by.items():
    if d["class"] == "SOURCE":
        bl = re.findall(r"B\d{4}", d["source_ref"])
        if not bl: errors.append("%s: SOURCE row cites no B-block" % k)
        elif not any(k in pbmap.get(b, "") for b in bl): errors.append("%s: none of %s maps back to it in source-coverage.csv" % (k, bl))

readme = open(P("docs/analysis/README.md"), encoding="utf-8").read()
cls = Counter(d["class"] for d in by.values())
for c, v in cls.items():
    if not re.search(r"\|\s*%s\s*\|\s*%d\s*\|" % (c, v), readme): errors.append("README count for %s != %d" % (c, v))
if not re.search(r"\|\s*Total\s*\|\s*%d\s*\|" % len(by), readme): errors.append("README total != %d" % len(by))

print("rows=%d class=%s status=%s final_gate=%s" % (len(by), dict(cls), dict(Counter(d["status"] for d in by.values())), dict(sorted(Counter(d["final_gate"] for d in by.values()).items()))))
print("DG0-final (%d) == assigned (%d): %s ; IMPLEMENTED == DG0-final: %s" % (len(dg0), len(ASSIGNED), dg0 == sorted(ASSIGNED), impl == dg0))
print("source-coverage rows=%d %s ; master-prompt-coverage rows=%d %s" % (sc[0], sc[1], mc[0], mc[1]))
print("implementation anchors:"); [print("  " + l) for l in anchor_lines]
print("notes (%d):" % len(notes)); [print("  - " + n) for n in notes]
print("errors (%d):" % len(errors)); [print("  - " + e) for e in errors]
print("RESULT: %s" % ("PASS" if not errors else "FAIL"))
sys.exit(1 if errors else 0)
