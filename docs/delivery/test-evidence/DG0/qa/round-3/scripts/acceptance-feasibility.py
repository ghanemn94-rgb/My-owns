# Independent feasibility / F-DG0-203 check (qa-verifier, DG0 round 2). Usage: python3 acceptance-feasibility.py <repo>
import re, sys, csv, os
repo = sys.argv[1]
am = open(os.path.join(repo, "docs/analysis/acceptance-map.md"), encoding="utf-8").read()
sp = open(os.path.join(repo, "docs/analysis/stage-plan.md"), encoding="utf-8").read()
reqs = {r["req_id"]: r for r in csv.DictReader(open(os.path.join(repo, "docs/delivery/requirements.csv"), encoding="utf-8"))}
err = []
def firstP(s):
    m = re.search(r"P(\d)", s); return int(m.group(1)) if m else None
def gate(s):
    m = re.search(r"DG(\d)", s); return int(m.group(1)) if m else None
amap = {}
for line in am.splitlines():
    c = [x.strip() for x in line.strip().strip("|").split("|")]
    if len(c) == 7 and re.fullmatch(r"A\d\d", c[0]):
        amap[c[0]] = dict(test=c[2], level=c[3], first=firstP(c[4]), gate=gate(c[5]), proves=c[6])
own = {}
sec = sp.split("## Executable acceptance-test ownership")[1] if "## Executable acceptance-test ownership" in sp else ""
for line in sec.splitlines():
    c = [x.strip() for x in line.strip().strip("|").split("|")]
    if len(c) == 6 and re.fullmatch(r"A\d\d", c[0]):
        own[c[0]] = dict(test=c[1], authored=c[2], first=firstP(c[2]), gate=gate(c[3]), author=c[4])
LEVELS = {"unit", "integration", "e2e", "visual", "ops drill", "ops", "CI", "unit (validator)", "ops (gate audit)", "ops (sealing check)"}
for n in range(1, 29):
    a = f"A{n:02d}"; t = f"REQ-S20-{n:03d}"
    m = amap.get(a); o = own.get(a)
    if not m: err.append(f"{a}: missing from acceptance-map"); continue
    if not o: err.append(f"{a}: missing from stage-plan ownership table"); continue
    if m["test"] != t or o["test"] != t: err.append(f"{a}: test row {m['test']}/{o['test']} != {t}")
    if t not in reqs: err.append(f"{a}: {t} not in register")
    else:
        rg = int(reqs[t]["final_gate"][2:])
        if a != "A28" and rg != m["gate"]: err.append(f"{a}: register {t} final_gate DG{rg} != must-pass DG{m['gate']}")
        if a == "A28" and rg != 7: err.append(f"{a}: {t} final_gate DG{rg}")
    lv = [x.strip() for x in m["level"].split(";")]
    if not all(any(x.startswith(L.split(" ")[0]) for L in LEVELS) for x in lv): err.append(f"{a}: unknown test level {m['level']}")
    if m["first"] is None or m["gate"] is None: err.append(f"{a}: no stage/gate"); continue
    if m["first"] > m["gate"]: err.append(f"{a}: first delivered P{m['first']} after must-pass DG{m['gate']}")
    if o["first"] != m["first"]: err.append(f"{a}: ownership authored-in first P{o['first']} != acceptance-map first P{m['first']}")
    if o["gate"] != m["gate"]: err.append(f"{a}: ownership must-pass DG{o['gate']} != acceptance-map DG{m['gate']}")
    if not o["author"] or o["author"] in ("—", "-"): err.append(f"{a}: no scenario author")
    # the stage section for the first-delivered stage must mention the scenario (authored there)
    stage_sec = re.split(r"\n## ", sp)
    sect = next((s for s in stage_sec if s.startswith(f"P{m['first']} ")), "")
    if a not in sect and m["first"] > 0: err.append(f"{a}: stage-plan P{m['first']} section does not mention {a}")
    # every requirement 'proved' by the scenario must cite it in acceptance
    for rid in re.findall(r"REQ-[A-Z0-9]+-\d{3}", m["proves"]):
        if rid in reqs and not re.search(rf"\b{a}\b", reqs[rid]["acceptance"]): err.append(f"{a}: {rid} listed as proved but does not cite {a}")
    print(f"{a} {t} level={m['level']:<32} first=P{m['first']} pass=DG{m['gate']} author={o['author'][:40]}")
# expand ranges in 'proves' check the reverse: every row citing A-x is listed (ranges expanded)
def expand(s):
    out = set()
    for part in re.split(r"[;,]\s*", s):
        part = part.strip()
        m = re.fullmatch(r"(REQ-[A-Z0-9]+-)(\d{3})(?:\.\.(\d{3}))?", part)
        if m:
            lo = int(m.group(2)); hi = int(m.group(3) or lo)
            out |= {f"{m.group(1)}{i:03d}" for i in range(lo, hi + 1)}
    return out
for a, m in amap.items():
    listed = expand(m["proves"])
    citing = {r for r, v in reqs.items() if re.search(rf"\b{a}\b", v["acceptance"]) and r != m["test"]}
    if listed - set(reqs): err.append(f"{a}: proves lists unknown {sorted(listed - set(reqs))[:5]}")
    if citing - listed: err.append(f"{a}: rows cite {a} but are not listed: {sorted(citing - listed)[:8]}")
    if listed - citing: err.append(f"{a}: listed but do not cite {a}: {sorted(listed - citing)[:8]}")
for e in err: print("ERROR", e)
print("errors:", len(err)); sys.exit(1 if err else 0)
