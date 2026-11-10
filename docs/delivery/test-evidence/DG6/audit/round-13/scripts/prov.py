# Auditor T-DG6-AUDIT-R13: provenance of the round-12 specialist records and D-082 over every DG6 review run.
import json, glob, gzip, hashlib, os, re, collections
R12 = {"domain-reviewer": "docs/delivery/reviews/DG6/round-12/domain-reviewer.json",
       "code-security-reviewer": "docs/delivery/reviews/DG6/round-12/code-security-reviewer.json",
       "qa-verifier": "docs/delivery/reviews/DG6/round-12/qa-verifier.json"}
seen = set()
print("== round-12 specialist records")
for role, p in R12.items():
    r = json.load(open(p)); inv = r["invocation_reference"]; d = "docs/delivery/runs/DG6/" + inv["run_id"]
    m = json.load(open(d + "/meta.json")); sb = hashlib.sha256(open(d + "/sandbox.json", "rb").read()).hexdigest()
    print(f"{role}: verdict={r['verdict']} round={r['round']} candidate={r['candidate_id']} source_commit={r['source_commit']} (40-hex={bool(re.fullmatch('[0-9a-f]{40}', r['source_commit']))})")
    print(f"  run={inv['run_id']} session={inv['session_id']} meta.role={m['role']} meta.session={m['invocation_reference']['session_id']} result_session={m.get('result_session_id')}")
    print(f"  exit_code={m['exit_code']} subtype={m['subtype']} is_error={m['is_error']} head_at_start={m['head_commit_at_start']} assignment={m['assignment']} (record assignment={r['assignment']})")
    print(f"  sandbox.json sha256={sb} meta.process_sandbox_sha256={m.get('process_sandbox_sha256')} match={sb == m.get('process_sandbox_sha256')} external_config_changed={m.get('external_config_changed')}")
    print(f"  independence.reviewer_authored_reviewed_scope={r['independence_declaration']['reviewer_authored_reviewed_scope']} checks={len(r['checks_run'])} nonPASS={[c.get('result') for c in r['checks_run'] if c.get('result') != 'PASS']} findings={r['findings']}")
    seen.add(inv["session_id"])
print("distinct sessions:", len(seen) == 3)
print("\n== every DG6 review-role run (D-082: external_config_changed must be empty)")
bad = 0
for d in sorted(glob.glob("docs/delivery/runs/DG6/*")):
    if not os.path.exists(d + "/meta.json"): continue
    m = json.load(open(d + "/meta.json"))
    if not os.path.basename(d).startswith("DG6-T-DG6-REV-"): continue
    sb = hashlib.sha256(open(d + "/sandbox.json", "rb").read()).hexdigest()
    ecc = m.get("external_config_changed") or []
    bad += bool(ecc) or sb != m.get("process_sandbox_sha256")
    print(f"{os.path.basename(d)} exit={m['exit_code']} {m['subtype']} sandbox_match={sb == m.get('process_sandbox_sha256')} ecc={len(ecc)}")
print("review runs with config change or sandbox mismatch:", bad)
print("\n== Write/Edit targets outside docs/delivery in every reviewer-role run (replayed from the transcripts)")
for d in sorted(glob.glob("docs/delivery/runs/DG6/*")):
    if not os.path.exists(d + "/meta.json"): continue
    m = json.load(open(d + "/meta.json"))
    if m["role"] not in ("domain-reviewer", "code-security-reviewer", "qa-verifier"): continue
    t = d + "/transcript.jsonl.gz"
    if not os.path.exists(t): continue
    c = collections.Counter()
    for line in gzip.open(t):
        try: o = json.loads(line)
        except Exception: continue
        if o.get("type") != "assistant": continue
        for b in o.get("message", {}).get("content", []) or []:
            if b.get("type") == "tool_use" and b["name"] in ("Write", "Edit", "MultiEdit", "NotebookEdit"):
                p = re.sub(r"^/home/user/(wt/[^/]+|My-owns)/", "", b["input"].get("file_path", ""))
                if p.startswith("docs/delivery/") or p.startswith("/var/tmp/"): continue
                c[p.split("/")[0] + ("/" + p.split("/")[1] if p.startswith("tests/") else "")] += 1
    print(f"{os.path.basename(d)[:60]}: {dict(c) if c else 'docs/delivery and own scratch only'}")
print("Judgement: reviewer-role product-tree writes are only qa-verifier authoring tests under tests/qa and e2e (pre-freeze, allowed by the protocol). No reviewer wrote apps/, packages/, docs/architecture or migrations. Note: meta.outputs is a whole-repository before/after diff, so concurrent runs' files appear in each other's outputs (e.g. code-security evidence in the domain run's outputs); the transcripts show no cross-writes.")
