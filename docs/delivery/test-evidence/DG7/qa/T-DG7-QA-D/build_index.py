#!/usr/bin/env python3
"""T-DG7-QA-D: build REQ-S20-031's per-gate test-level index from the APPROVED gate records and the review records
they cite (read-only). Every check is classified by test level from its own procedure/command text; nothing is
inferred as passed unless a record states a result with an executed command. Run from the repository root."""
import json, os, re, glob, sys

GATES = ["DG0", "DG1", "DG2", "DG3", "DG4", "DG5", "DG6"]
ROLES = ["domain-reviewer", "code-security-reviewer", "qa-verifier"]
LEVELS = [
    ("e2e", re.compile(r"playwright|\be2e\b|end-to-end|chromium", re.I)),
    ("visual", re.compile(r"screenshot|visual|\baxe\b|\brtl\b|\.png\b|toHaveScreenshot|contrast|bilingual|arabic", re.I)),
    ("integration", re.compile(r"integration|with-pg|postgres|test:integration|disposable (pg|database|cluster)", re.I)),
    ("unit", re.compile(r"\bunit\b|pnpm test(?![:\w])|node --test|unit-node|unit-web|vitest run(?! --project integration)", re.I)),
]
NOT_RUN = re.compile(r"\bBLOCKED\b|could not run|not run\b|skipped|\bskip\b|not executed", re.I)

def text(c):
    return " ".join(str(c.get(k, "")) for k in ("id", "procedure", "command", "expected", "actual", "name"))

def levels(c):
    t = " ".join(str(c.get(k, "")) for k in ("id", "procedure", "command", "name"))
    ls = [n for n, rx in LEVELS if rx.search(t)]
    return ls or ["other"]

def ev_list(c):
    ev = c.get("evidence") or []
    return [ev] if isinstance(ev, str) else ev

def ev_ok(p):
    return os.path.isfile(p.split("#")[0])

def short(s, n=260):
    s = re.sub(r"\s+", " ", str(s)).strip()
    return s if len(s) <= n else s[: n - 1] + "…"

out = {"generated_by": "T-DG7-QA-D build_index.py", "gates": []}
for g in GATES:
    gr = json.load(open(f"docs/delivery/gates/{g}.json"))
    entry = {"gate": g, "decision": gr["decision"], "candidate_id": gr["candidate_id"], "source_commit": gr["source_commit"],
             "gate_record": f"docs/delivery/gates/{g}.json", "reviews": {}, "audit": gr["release_audit"], "checks": [],
             "level_counts": {}, "not_run_or_blocked": [], "missing_evidence": []}
    for role in ROLES:
        path = gr["reviews"][role]
        rec = json.load(open(path))
        entry["reviews"][role] = {"path": path, "verdict": rec["verdict"], "candidate_id": rec["candidate_id"]}
        for c in rec.get("checks_run", []):
            ls = levels(c)
            row = {"role": role, "record": path, "id": c.get("id", ""), "levels": ls, "result": c.get("result"),
                   "exit_status": c.get("exit_status"), "command": short(c.get("command", ""), 200),
                   "procedure": short(c.get("procedure", ""), 160), "evidence": ev_list(c)}
            entry["checks"].append(row)
            for l in ls:
                k = f"{l}:{c.get('result')}"
                entry["level_counts"][k] = entry["level_counts"].get(k, 0) + 1
            for p in ev_list(c):
                if not ev_ok(p):
                    entry["missing_evidence"].append({"record": path, "check": c.get("id", ""), "path": p})
            if c.get("result") != "PASS" or NOT_RUN.search(str(c.get("actual", ""))):
                m = NOT_RUN.search(str(c.get("actual", "")))
                ctx = str(c.get("actual", ""))
                if m:
                    a = max(0, m.start() - 160); ctx = ctx[a: m.end() + 200]
                entry["not_run_or_blocked"].append({"source": "approving round", "role": role, "record": path,
                    "check": c.get("id", ""), "result": c.get("result"), "levels": ls, "reason_excerpt": short(ctx, 380)})
    # Every round of the gate: checks recorded BLOCKED / FAIL (superseded or not) by any reviewer or the auditor.
    approving = {gr["reviews"][r] for r in ROLES} | {gr["release_audit"]}
    for path in sorted(glob.glob(f"docs/delivery/reviews/{g}/round-*/*.json")):
        if path.endswith((".verifications.json", ".findings.json")) or path in approving:
            continue
        try:
            rec = json.load(open(path))
        except Exception:
            continue
        if not isinstance(rec, dict) or "checks_run" not in rec:
            continue
        for c in rec["checks_run"]:
            if c.get("result") == "BLOCKED":
                entry["not_run_or_blocked"].append({"source": "earlier round (superseded by the approving round)",
                    "role": rec.get("reviewer_role"), "record": path, "check": c.get("id", ""), "result": "BLOCKED",
                    "levels": levels(c), "reason_excerpt": short(c.get("actual", ""), 380)})
    entry["gate_tests"] = [{"name": short(t.get("name", ""), 200), "result": t.get("result"),
                            "evidence": t.get("evidence", [])} for t in gr.get("tests", [])]
    out["gates"].append(entry)

json.dump(out, open(sys.argv[1], "w"), indent=1, ensure_ascii=False)
for e in out["gates"]:
    print(e["gate"], e["decision"], "checks", len(e["checks"]), e["level_counts"], "not-run/blocked",
          len(e["not_run_or_blocked"]), "missing-evidence", len(e["missing_evidence"]))
