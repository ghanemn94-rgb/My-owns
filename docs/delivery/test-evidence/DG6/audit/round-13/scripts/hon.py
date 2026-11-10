# Auditor T-DG6-AUDIT-R13: every cited evidence path exists (regular file); every failure marker in a cited log is in a
# log the citing record names, and the record's text explains it (excerpt printed for judgement).
import json, os, re
pat = re.compile(r"(\b[1-9]\d* failed\b|\b[1-9]\d* flaky\b|rc[= ]+[1-9]\d*\b|exit(?:ed)?(?: code| status|=| with)? ?[1-9]\d*\b|Test timed out|Hook timed out|Unhandled|ELIFECYCLE|Command failed|✘)")
for role in ["domain-reviewer", "code-security-reviewer", "qa-verifier"]:
    r = json.load(open(f"docs/delivery/reviews/DG6/round-12/{role}.json"))
    text = json.dumps(r, ensure_ascii=False)
    paths = set(p.split("#")[0] for p in r["evidence_paths"])
    for c in r["checks_run"]:
        for p in c.get("evidence", []) or []: paths.add(p.split("#")[0])
    missing = [p for p in paths if not os.path.isfile(p)]
    print(f"===== {role}: {len(paths)} cited paths, missing/not-regular: {missing}")
    for p in sorted(paths):
        if not re.search(r"\.(log|txt|out)$", p) or not os.path.isfile(p): continue
        hits = {}
        for line in open(p, errors="replace"):
            if "✓" in line: continue
            for m in pat.findall(line): hits[m] = hits.get(m, 0) + 1
        if not hits: continue
        b = os.path.basename(p); i = text.find(b)
        print(f"  {b}: {hits} | named in record: {i >= 0}")
        if i >= 0: print("    record context: …" + text[max(0, i - 220): i + 200].replace("\\n", " ") + "…")
