# qa-verifier T-DG4-QA-B mutation runner. Applies ONE textual mutation to the disposable copy ($MUT, under $TMPDIR),
# runs the targeted acceptance tests in that copy, and restores the file. It never touches the worktree.
# Usage: MUT=$TMPDIR/mut python3 mutate.py '<json spec>'
#   spec: {"id", "edits": [{"file", "old", "new"}, ...], "test", "filter", "port", "pool"}; no edits = the baseline.
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
    text = originals.get(path) or open(path).read()
    originals.setdefault(path, text)
    current = open(path).read()
    assert current.count(e["old"]) == 1, f"mutation anchor not unique/absent in {e['file']}: {e['old']!r}"
    open(path, "w").write(current.replace(e["old"], e["new"]))
try:
    env = dict(os.environ, QA_PG_PORT=spec["port"], MTH_PORT_POOL=spec["pool"])
    cmd = ["tests/qa/support/with-pg.sh", "pnpm", "vitest", "run", "--configLoader", "runner", "--project",
           "integration", spec["test"], "-t", spec["filter"]]
    r = subprocess.run(cmd, cwd=M, env=env, capture_output=True, text=True, timeout=900)
    out = r.stdout + r.stderr
    files = ",".join(sorted({e["file"] for e in spec.get("edits", [])})) or "-"
    print("MUTATION", spec["id"], "files", files, "vitest exit", r.returncode)
    print("CMD", " ".join(cmd))
    for line in out.splitlines():
        if any(k in line for k in ("✓", "×", "Tests ", "AssertionError", "→")):
            print("  ", line.strip()[:400])
finally:
    for path, text in originals.items():
        open(path, "w").write(text)
        assert open(path).read() == text
