# Applies one mutation to the disposable copy, runs the targeted tests, restores the file. Never touches the worktree.
import json, os, shutil, subprocess, sys
M = os.environ["MUT"]
spec = json.loads(sys.argv[1])
path = os.path.join(M, spec["file"])
assert path.startswith(os.environ["TMPDIR"]), path
orig = open(path).read()
if spec.get("old"):
    assert orig.count(spec["old"]) == 1, f"mutation anchor not unique/absent in {spec['file']}"
    open(path, "w").write(orig.replace(spec["old"], spec["new"]))
try:
    env = dict(os.environ, QA_PG_PORT=spec["port"], MTH_PORT_POOL=spec["pool"])
    cmd = ["tests/qa/support/with-pg.sh", "pnpm", "vitest", "run", "--configLoader", "runner", "--project", spec["project"], spec["test"], "-t", spec["filter"]]
    if spec["project"] != "integration":
        cmd = cmd[1:]
    r = subprocess.run(cmd, cwd=M, env=env, capture_output=True, text=True, timeout=900)
    out = r.stdout + r.stderr
    print("MUTATION", spec["id"], "file", spec["file"], "exit", r.returncode)
    print("CMD", " ".join(cmd))
    for line in out.splitlines():
        if any(k in line for k in ("✓", "×", "Tests ", "AssertionError", "Error:", "FAIL")):
            print("  ", line.strip()[:400])
finally:
    open(path, "w").write(orig)
