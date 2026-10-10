# qa-verifier T-DG4-QA-B mutation runner (rewritten in the salvage run T-DG4-QA-BB).
# Applies ONE textual mutation to product source in the DISPOSABLE copy $MUT (under $TMPDIR), runs the targeted
# acceptance test in that copy, then restores the file byte for byte. It never touches the worktree.
# Usage: MUT=$TMPDIR/mut python3 -I mutate.py '<json spec>'
#   spec: {"id", "edits": [{"file", "old", "new"}], "test", "filter", "port", "pool"}; no edits = the baseline.
# A mutation is KILLED when vitest exits non-zero with at least one failed test; SURVIVED when it exits 0.
import json
import os
import subprocess
import sys

M = os.environ["MUT"]
assert M.startswith(os.environ["TMPDIR"]), M
spec = json.loads(sys.argv[1])
originals = {}
for e in spec.get("edits", []):
    path = os.path.join(M, e["file"])
    current = open(path).read()
    originals.setdefault(path, current)
    assert current.count(e["old"]) == 1, f"mutation anchor not unique/absent in {e['file']}: {e['old']!r}"
    open(path, "w").write(current.replace(e["old"], e["new"]))
try:
    env = dict(os.environ, QA_PG_PORT=spec["port"], MTH_PORT_POOL=spec["pool"])
    cmd = ["tests/qa/support/with-pg.sh", "pnpm", "vitest", "run", "--configLoader", "runner", "--project",
           "integration", spec["test"], "-t", spec["filter"]]
    r = subprocess.run(cmd, cwd=M, env=env, capture_output=True, text=True, timeout=900)
    out = r.stdout + r.stderr
    edits = spec.get("edits", [])
    print("=" * 100)
    print("MUTATION", spec["id"], "| vitest exit", r.returncode,
          "| verdict", "BASELINE" if not edits else ("KILLED" if r.returncode != 0 else "SURVIVED"))
    for e in edits:
        print("  file:", e["file"])
        print("  old :", e["old"])
        print("  new :", e["new"])
    print("CMD (cwd = disposable copy):", "QA_PG_PORT=" + spec["port"], "MTH_PORT_POOL=" + spec["pool"], " ".join(cmd))
    for line in out.splitlines():
        s = line.strip()
        if any(k in s for k in ("✓", "×", "Test Files", "Tests ", "AssertionError", "Expected", "Received", "FAIL ")):
            print("  ", s[:400])
finally:
    for path, text in originals.items():
        open(path, "w").write(text)
        assert open(path).read() == text
