# T-DG4-ARCH-R1 item 3: the migration-seeded keys checked against the contract patterns. Run from the repo root.
import re, glob
sql = "".join(open(f).read() for f in sorted(glob.glob("packages/db/migrations/*.sql")))
kinds = set()
for m in re.finditer(r"INSERT INTO work_item_kind\s*\(([^)]*)\)\s*VALUES(.*?);", sql, re.S):
    for t in re.finditer(r"\(\s*'([^']*)'", m.group(2)):
        kinds.add(t.group(1))
print("work_item_kind codes:", len(kinds), "not matching ^[a-z_]+$:", [k for k in kinds if not re.fullmatch(r"[a-z_]+", k)])
steps = set(re.findall(r"'((?:diagnose|define|design|mobilize|transform|realize)\.[A-Za-z0-9_]+)'", sql))
print("step keys:", len(steps), "not matching StepKey:", [s for s in steps if not re.fullmatch(r"(diagnose|define|design|mobilize|transform|realize)\.[a-z_]{1,48}", s)], "longest suffix:", max(len(s.split(".", 1)[1]) for s in steps))
crit = set(re.findall(r"'(g[1-6]\.[A-Za-z0-9_]+)'", sql))
print("criterion keys:", len(crit), "not matching CriterionKey:", [c for c in crit if not re.fullmatch(r"g[1-6]\.[a-z_]{1,48}", c)])
