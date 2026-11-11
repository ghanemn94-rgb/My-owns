#!/usr/bin/env python3
"""release-auditor T-DG6-AUDIT-RG-R4: provenance and independence of the DG6 re-gate review runs.
Run from the repository root (read-only). Prints one block per run and per gate record."""
import glob, gzip, hashlib, json, os, subprocess

RUNS = "docs/delivery/runs/DG6"
GATE = {
    "domain-reviewer": "docs/delivery/reviews/DG6/round-3/domain-reviewer.json",
    "code-security-reviewer": "docs/delivery/reviews/DG6/round-3/code-security-reviewer.json",
    "qa-verifier": "docs/delivery/reviews/DG6/round-3/qa-verifier.json",
}
CAND = "sha256:32e41b5581a9beeba357a6c0dd5b50c414226910232ebfbb711c2178024376b5"
SRC = "f56f1b3d24c00d1803f6627c99b3f422a47b3014"


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def git(*a):
    return subprocess.run(["git", *a], capture_output=True, text=True)


print("== all DG6 review/audit runs of the re-gate (run_id, exit, subtype, sandbox match, external_config_changed, deleted)")
for d in sorted(glob.glob(f"{RUNS}/DG6-T-DG6-*-RG-R*")):
    rid = os.path.basename(d)
    m = os.path.join(d, "meta.json")
    if not os.path.exists(m):
        print(f"{rid}: NO meta.json (files: {sorted(os.listdir(d))})")
        continue
    j = json.load(open(m))
    sb = os.path.join(d, "sandbox.json")
    sbok = os.path.exists(sb) and sha(sb) == j.get("process_sandbox_sha256")
    print(f"{rid}: exit={j.get('exit_code')} subtype={j.get('subtype')} is_error={j.get('is_error')} "
          f"process_sandbox={j.get('process_sandbox')} bash_sandbox={j.get('bash_sandbox')} sandbox.json-sha-matches={sbok} "
          f"external_config_changed={j.get('external_config_changed')} deleted={j.get('deleted')} "
          f"discarded={j.get('process_sandbox_discarded')} head={j.get('head_commit_at_start')}")

print()
print("== the three gate records")
seen_runs, seen_sessions = set(), set()
for role, rec in GATE.items():
    r = json.load(open(rec))
    inv = r["invocation_reference"]
    d = f"{RUNS}/{inv['run_id']}"
    j = json.load(open(f"{d}/meta.json"))
    print(f"-- {role}: {rec}")
    print(f"   verdict={r['verdict']} round={r['round']} candidate_ok={r['candidate_id'] == CAND} source_commit_full40={r['source_commit'] == SRC}")
    print(f"   run={inv['run_id']} session={inv['session_id']}")
    print(f"   meta.invocation_reference == record: {j['invocation_reference'] == inv}; meta.role={j['role']}; result_session_id==session: {j.get('result_session_id') == inv['session_id']}")
    print(f"   exit={j['exit_code']} subtype={j['subtype']} is_error={j['is_error']} sandbox_ok={sha(d + '/sandbox.json') == j['process_sandbox_sha256']} ext={j['external_config_changed']}")
    print(f"   assignment={j['assignment']} == record: {j['assignment'] == r['assignment']}; assignment sha ok: {sha(j['assignment']) == j['assignment_sha256']}")
    print(f"   head_at_start={j['head_commit_at_start']} contains source_commit: {git('merge-base', '--is-ancestor', SRC, j['head_commit_at_start']).returncode == 0}")
    print(f"   started={j['started_at']} finished={j['finished_at']} (round frozen 2026-11-11T01:42:18Z)")
    for k in j["tool_authored"]:
        if "/reviews/" in k:
            print(f"   tool_authored {k}: on-disk sha matches meta: {sha(k) == j['tool_authored'][k] if isinstance(j['tool_authored'], dict) else sha(k) == j['outputs'].get(k)}")
    # transcript-level sanity: the session id appears in the transcript
    with gzip.open(f"{d}/transcript.jsonl.gz", "rt") as fh:
        first = fh.readline()
    print(f"   transcript first line carries the session id: {inv['session_id'] in first}")
    impl = r["implementation_author"]
    print(f"   reviewer listed among implementation authors: {role in impl}; independence.reviewer_authored_reviewed_scope={r['independence_declaration']['reviewer_authored_reviewed_scope']}")
    seen_runs.add(inv["run_id"]); seen_sessions.add(inv["session_id"])
print(f"distinct run ids: {len(seen_runs)}; distinct sessions: {len(seen_sessions)}")

print()
print("== did any reviewer role implement DG6? (handbacks and runs by task role)")
roles = {}
for d in sorted(glob.glob(f"{RUNS}/*")):
    m = os.path.join(d, "meta.json")
    if os.path.exists(m):
        j = json.load(open(m))
        roles.setdefault(j.get("role"), []).append(j.get("task"))
for role in ["domain-reviewer", "code-security-reviewer", "release-auditor", "qa-verifier"]:
    tasks = sorted(set(t for t in roles.get(role, []) if t))
    print(f"{role}: {len(tasks)} tasks: {tasks}")
hb = sorted(glob.glob("docs/delivery/handbacks/DG6/*"))
print("handbacks naming a reviewer role:", [h for h in hb if any(x in h for x in ("domain-reviewer", "code-security-reviewer", "release-auditor"))])
