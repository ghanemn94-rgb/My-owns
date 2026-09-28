# code-security round 6: would a stricter write-once rule (exactly one distinct blob per write-once path across EVERY
# add/modify event against EVERY parent, no M/T events) pass on the real DG0 history? Read-only git inspection.
import subprocess, collections, sys
rev = sys.argv[1] if len(sys.argv) > 1 else "HEAD"
specs = [":(glob)docs/delivery/reviews/DG0/**", ":(glob)docs/delivery/runs/DG0/**", ":(glob)docs/delivery/candidates/DG0/**", ":(glob)docs/delivery/assignments/DG0/round-*/**"]
g = lambda *a: subprocess.run(["git", *a], capture_output=True, text=True, check=True).stdout
merges = g("rev-list", "--merges", rev).split()
back = 0
for line in g("rev-list", "--parents", rev).splitlines():
    c, *ps = line.split()
    t = int(g("show", "-s", "--format=%ct", c))
    back += any(int(g("show", "-s", "--format=%ct", p)) > t for p in ps)
raw = g("log", "-m", "--full-history", "--no-renames", "--raw", "--no-abbrev", "--format=@%H", rev, "--", *specs)
blobs, status = collections.defaultdict(set), collections.Counter()
for l in raw.splitlines():
    if l.startswith(":"):
        meta, path = l.split("\t", 1); f = meta.split(); st = f[4][0]; status[st] += 1
        if st != "D": blobs[path].add(f[3])
print(f"# real history @ {g('rev-parse', rev).strip()}: stricter write-once rule feasibility")
print("merge commits in history:", len(merges))
print("commits whose committer date is older than a parent's:", back)
print("events by status:", dict(status))
print("paths:", len(blobs), "paths with >1 distinct blob:", sum(len(v) > 1 for v in blobs.values()))
