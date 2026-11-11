#!/usr/bin/env python3
"""release-auditor T-DG6-AUDIT-RG-R4: DG6 findings terminal state, fix_revision anchors and the sidecar mirror.
Run from the repository root (read-only)."""
import glob, json, os, re, subprocess

GATE_SRC = "f56f1b3d24c00d1803f6627c99b3f422a47b3014"


def git(*a):
    return subprocess.run(["git", *a], capture_output=True, text=True)


def anc(a, b):
    return git("merge-base", "--is-ancestor", a, b).returncode == 0


f = json.load(open("docs/delivery/findings.json"))
L = f if isinstance(f, list) else f["findings"]
dg6 = [x for x in L if x["id"].startswith("F-DG6")]
stages = json.load(open("docs/delivery/stages.json"))
st = [s for s in stages["stages"] if s["id"] == "DG6"][0]
rounds = {r["round"]: r for r in st["review_rounds"]}

# sidecars
side_f, side_v = {}, {}
for p in sorted(glob.glob("docs/delivery/reviews/DG6/round-*/*.findings.json")):
    for x in json.load(open(p)).get("findings", []):
        side_f.setdefault(x["id"], []).append((p, x))
for p in sorted(glob.glob("docs/delivery/reviews/DG6/round-*/*.verifications.json")):
    rnd = int(re.search(r"round-(\d+)", p).group(1))
    role = os.path.basename(p).split(".")[0]
    rec = p.replace(".verifications.json", ".json")
    for v in json.load(open(p)).get("verifications", []):
        side_v.setdefault(v["finding_id"], []).append((rnd, role, p, os.path.exists(rec), v))

print(f"DG6 findings in findings.json: {len(dg6)}")
unresolved_ch = [x["id"] for x in dg6 if x["severity"] in ("Critical", "High") and x["status"] not in ("CLOSED_VERIFIED",)]
unresolved_mand = [x["id"] for x in dg6 if x["mandatory_violation"] and x["status"] != "CLOSED_VERIFIED"]
nonterminal = [x["id"] for x in dg6 if x["status"] not in ("CLOSED_VERIFIED", "ACCEPTED_OBSERVATION")]
print(f"unresolved Critical/High: {unresolved_ch}; unresolved mandatory: {unresolved_mand}; non-terminal: {nonterminal}")
print(f"ACCEPTED_OBSERVATION: {[x['id'] for x in dg6 if x['status'] == 'ACCEPTED_OBSERVATION']}")
print()
for x in dg6:
    fid = x["id"]
    print(f"== {fid} {x['severity']} mandatory={x['mandatory_violation']} status={x['status']} owner={x['owner']} reported_by={x['reported_by']}")
    print(f"   reported_in={x['reported_in']} exists={os.path.exists(x['reported_in'])}")
    # mirror of the raising sidecar
    srcs = side_f.get(fid, [])
    for p, s in srcs:
        same = all(s.get(k) == x.get(k) for k in ("severity", "mandatory_violation", "requirement", "title", "reproduction", "expected", "actual", "evidence", "reported_by", "reported_in", "owner"))
        print(f"   raised in sidecar {p}: core fields equal in findings.json: {same}")
    # verifications: the validator's choice is the first sidecar (sorted by file name) of the highest round, unless a FAIL in that round
    vs = sorted(side_v.get(fid, []), key=lambda t: t[0])
    for rnd, role, p, recok, v in vs:
        print(f"   verification r{rnd} {role}: {v['result']} -> {v.get('status_after')} (record exists: {recok})")
    counted = [t for t in vs if t[3]]
    top = max(t[0] for t in counted) if counted else None
    chosen = None
    for t in counted:
        if chosen is None or t[0] > chosen[0] or (t[0] == chosen[0] and t[4]["result"] == "FAIL"):
            chosen = t
    if chosen:
        rnd, role, p, _, v = chosen
        rec = json.load(open(p.replace(".verifications.json", ".json")))
        ver = x.get("verification", {})
        print(f"   validator-selected sidecar: {p}; findings.json verification by_role={ver.get('by_role')} equal role: {ver.get('by_role') == role}; "
              f"invocation equal: {ver.get('invocation_reference') == rec['invocation_reference']}; evidence equal: {ver.get('evidence') == v.get('evidence')}; "
              f"note equal: {ver.get('note') == v.get('note')}; result {ver.get('result')}")
        print(f"   verifier is owner: {role == x['owner']}; all round-{rnd} verifications PASS: {all(t[4]['result'] == 'PASS' for t in counted if t[0] == rnd)}")
        fr = x.get("fix_revision")
        r = rounds[rnd]
        meta = json.load(open(f"docs/delivery/runs/DG6/{rec['invocation_reference']['run_id']}/meta.json"))
        typ = git("cat-file", "-t", fr).stdout.strip() if fr else None
        print(f"   fix_revision={fr} full40={bool(fr and re.fullmatch(r'[0-9a-f]{40}', fr))} type={typ} subject='{git('log', '-1', '--format=%s', fr).stdout.strip()}'")
        print(f"   ancestor of verifying round source {r['source_commit'][:10]}: {anc(fr, r['source_commit'])}; of verifying run head {meta['head_commit_at_start'][:10]}: {anc(fr, meta['head_commit_at_start'])}; of gate candidate {GATE_SRC[:10]}: {anc(fr, GATE_SRC)}")
        # the fix commit must post-date the round the finding was raised in (it is a real repair, not a pre-existing commit)
        raised_round = int(re.search(r"round-(\d+)", x["reported_in"]).group(1))
        raised_src = rounds[raised_round]["source_commit"]
        print(f"   fix is NOT an ancestor of the raising round's source {raised_src[:10]} (i.e. it came after the finding): {not anc(fr, raised_src)}")
