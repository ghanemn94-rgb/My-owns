#!/usr/bin/env python3
"""release-auditor T-DG6-AUDIT-RG-R4: evidence honesty of the three round-3 gate records.
For each record: every cited path exists as a regular file; every cited log is grepped for non-zero exits, failures,
timeouts, kills, flakes and retries; for each log with hits, report whether the record's text names that log (the
disclosure). Logs with hits that the record does not name are listed for manual reading."""
import json, os, re

PAT = re.compile(r"(exit(?:_status)?[=: ]+[1-9][0-9]*\b|\brc[=: ]+[1-9]|\b[1-9][0-9]* failed\b|^\s*FAIL\b| FAIL |✘|×|timed out|Timeout|Killed|\bflaky\b|retry #|ELIFECYCLE|Unhandled)", re.M)
BENIGN = re.compile(r'"failed":0|role × month|× 2 |×2|\bx\b')

for role in ("domain-reviewer", "code-security-reviewer", "qa-verifier"):
    rp = f"docs/delivery/reviews/DG6/round-3/{role}.json"
    r = json.load(open(rp))
    text = json.dumps(r)
    md = rp.replace(".json", ".md")
    if os.path.exists(md):
        text += open(md).read()
    vs = rp.replace(".json", ".verifications.json")
    if os.path.exists(vs):
        text += open(vs).read()
    paths = list(r["evidence_paths"])
    for c in r["checks_run"]:
        paths += c.get("evidence", [])
    paths = sorted(set(p.split("#")[0] for p in paths))
    missing = [p for p in paths if not os.path.isfile(p)]
    logs = [p for p in paths if p.endswith((".log", ".txt", ".rc")) and os.path.isfile(p)]
    print(f"===== {role}: {len(paths)} distinct cited paths, missing/not regular file: {missing}; logs: {len(logs)}")
    nz = [c["id"] for c in r["checks_run"] if c["exit_status"] not in (0, None)]
    print(f"checks with non-zero exit_status: {nz}")
    undisclosed = []
    for p in logs:
        hits = [m for m in PAT.finditer(open(p, errors="replace").read())]
        lines = set()
        content = open(p, errors="replace").read().splitlines()
        for i, line in enumerate(content):
            if PAT.search(line) and not BENIGN.search(line):
                lines.add(i)
        if not lines:
            continue
        named = os.path.basename(p) in text or os.path.basename(p).split(".")[0] in text or p in text
        print(f"  {p}: {len(lines)} hit lines; named in the record/sidecar/narrative: {named}")
        if not named:
            undisclosed.append(p)
            for i in sorted(lines)[:6]:
                print(f"      {i + 1}: {content[i][:200]}")
    print(f"logs with hits not named in the record: {len(undisclosed)}")
