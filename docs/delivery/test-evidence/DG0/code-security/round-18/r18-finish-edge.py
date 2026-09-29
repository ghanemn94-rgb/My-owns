# DG0 round 18, code-security-reviewer: F-DG0-150 fix edge cases for agent_sandbox.finish() (no bwrap needed).
# Builds a minimal plan.json by hand (the fields finish() reads) in a throwaway dir under $TMPDIR.
#  1. collision on round-2/code-security-reviewer.a.json (real file appears after prepare) -> discard, loop continues,
#     later-sorted round-2/code-security-reviewer.b.json is still copied back; sandbox.json written; exit 3.
#  2. the real dest of a new own-role file is a symlink (dangling, pointing outside) -> not followed, target not created.
# Usage: python3 -I -B r18-finish-edge.py <tools/agents dir under test>
import json, os, subprocess, sys, tempfile

agents = sys.argv[1]
base = tempfile.mkdtemp(prefix="r18-finish-", dir=os.environ["TMPDIR"])
real = os.path.join(base, "repo/docs/delivery/reviews/DG0"); staging = os.path.join(base, "state/staging/0")
os.makedirs(os.path.join(real, "round-2")); os.makedirs(os.path.join(staging, "round-2"))
outside = os.path.join(base, "outside-target.json")
for n in ["a", "b", "c"]:
    with open(os.path.join(staging, "round-2", f"code-security-reviewer.{n}.json"), "w") as f:
        f.write('{"mine":"%s"}\n' % n)
with open(os.path.join(real, "round-2/code-security-reviewer.a.json"), "w") as f:
    f.write('{"theirs":1}\n')                                              # appeared after prepare -> collision
os.symlink(outside, os.path.join(real, "round-2/code-security-reviewer.c.json"))  # planted dangling symlink at dest
plan = {"schema": "mth-process-sandbox-v1", "role": "code-security-reviewer", "root": os.path.join(base, "repo"),
        "confined": True, "run_tmp": base, "binds": [], "protected": [], "cgroup_api": None,
        "staged": [{"rel": "docs/delivery/reviews/DG0", "real": real, "staging": staging,
                    "accept": r"round-[0-9]+/code\-security\-reviewer\.[^/]+", "replace": False, "copied": None,
                    "bound": [], "baseline": {}, "seed": {}}]}
with open(os.path.join(base, "state/plan.json"), "w") as f:
    json.dump(plan, f)
out = os.path.join(base, "out"); os.makedirs(out)
r = subprocess.run([sys.executable, "-I", "-B", os.path.join(agents, "agent_sandbox.py"), "finish", os.path.join(base, "state"), out],
                   capture_output=True, text=True)
print("finish exit", r.returncode, "| stderr tail:", r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "")
sj = os.path.join(out, "sandbox.json")
if os.path.exists(sj):
    s = json.load(open(sj)); print("copied_back", s["copied_back"]); print("discarded", s["discarded"])
else:
    print("sandbox.json MISSING")
print("real a.json", open(os.path.join(real, "round-2/code-security-reviewer.a.json")).read().strip())
print("real b.json exists", os.path.exists(os.path.join(real, "round-2/code-security-reviewer.b.json")))
print("real c.json is still a symlink", os.path.islink(os.path.join(real, "round-2/code-security-reviewer.c.json")),
      "| symlink target created (followed)?", os.path.exists(outside))
subprocess.run(["rm", "-rf", base])
