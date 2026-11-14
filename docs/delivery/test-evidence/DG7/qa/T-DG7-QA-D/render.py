#!/usr/bin/env python3
import json, sys
d = json.load(open(sys.argv[1]))
L = []
w = L.append
LEVELS = ["unit", "integration", "e2e", "visual", "other"]
def cell(s): return str(s).replace("|", "\\|").replace("\n", " ")
w("# REQ-S20-031 test-level index, DG0–DG7 (T-DG7-QA-D, qa-verifier)")
w("")
w("Generated on 2026-11-14 from the repository at `12229e6b69c11105bde0d1693093c608254e1fef` (branch `claude/mobily-transformation-platform-dg6-regate`, DG7 BUILDING, not frozen; see \"Tree\" in the DG7 section). Generator: `T-DG7-QA-D/build_index.py` and `T-DG7-QA-D/render.py` (run from the repository root with `python3 -I`); machine-readable copy: `test-level-index.json` next to this file.")
w("")
w("## How to read this index")
w("")
w("- **DG0–DG6 (APPROVED).** For each gate, the rows are the `checks_run` of the three specialist records the gate record cites (the approving round), plus the gate record's own `tests[]` (the release audit). Result, exit status, command and evidence are copied **as recorded**: QA-D did not re-execute them here. Every evidence path was checked to exist as a regular file (column *ev*).")
w("- **Test level** is classified mechanically from the check's id, procedure and command (patterns in `build_index.py`): `unit`, `integration`, `e2e`, `visual` (screenshots, axe, RTL/Arabic, contrast), or `other` (validators, lint, typecheck, provenance, static review). A check can have several levels.")
w("- **Could not run.** Each gate lists (a) every check recorded `BLOCKED` in any earlier round of that gate (superseded by the approving round), and (b) every approving-round check whose recorded result text mentions BLOCKED, not run, skipped or not executed, with an excerpt of the reason. Part (b) is a text scan: a PASS check can appear there because it discloses skipped tests or an environmental residual.")
w("- **Standing environmental residuals** (disclosed in every gate since DG1/DG2): live package registry (D-057), live CI run (D-058), a real Keycloak / enterprise IdP (D-049; only the bundled test issuer ran; the SAML broker is documented, not run), Docker daemon (D-243 Q1), real external systems (no real Mobily system, mail server or connector endpoint). None of these was ever reported as passed.")
w("- **No check is reported as passed here without an executed command in its record.** DG0 has no e2e row: P0 delivered specifications and the gate tooling, not UI.")
w("")
w("## Summary per gate")
w("")
w("| Gate | Decision | Candidate | Source commit | unit | integration | e2e | visual | other | non-PASS checks in approving round | not-run / BLOCKED entries | missing evidence files |")
w("|---|---|---|---|---|---|---|---|---|---|---|---|")
for g in d["gates"]:
    cnt = {l: 0 for l in LEVELS}
    nonpass = 0
    for c in g["checks"]:
        for l in c["levels"]: cnt[l] += 1
        if c["result"] != "PASS": nonpass += 1
    w(f"| {g['gate']} | {g['decision']} | `{g['candidate_id'][:19]}…` | `{g['source_commit'][:12]}` | " + " | ".join(str(cnt[l]) for l in LEVELS) + f" | {nonpass} | {len(g['not_run_or_blocked'])} | {len(g['missing_evidence'])} |")
w("| DG7 | BUILDING (no gate record) | not frozen | — | see §DG7 | see §DG7 | pending (freeze) | pending (freeze) | see §DG7 | — | see §DG7 | — |")
w("")
for g in d["gates"]:
    w(f"## {g['gate']} ({g['decision']})")
    w("")
    w(f"- Gate record: `{g['gate_record']}`; candidate `{g['candidate_id']}`; source `{g['source_commit']}`.")
    for r, v in g["reviews"].items():
        w(f"- {r}: `{v['path']}`, verdict {v['verdict']}, candidate {'= gate' if v['candidate_id']==g['candidate_id'] else 'DIFFERS: '+v['candidate_id']}.")
    w(f"- Release audit: `{g['audit']}`.")
    w("")
    for lvl in LEVELS:
        rows = [c for c in g["checks"] if lvl in c["levels"]]
        w(f"### {g['gate']} {lvl} ({len(rows)})")
        w("")
        if not rows:
            w("None recorded at this level." + (" P0 had no UI." if g["gate"]=="DG0" and lvl=="e2e" else ""))
            w("")
            continue
        w("| Role | Check | Result | Exit | Command (truncated) | Evidence (first) | ev |")
        w("|---|---|---|---|---|---|---|")
        for c in rows:
            ev = c["evidence"][0] if c["evidence"] else ""
            ok = "ok" if c["evidence"] and not any(m["check"]==c["id"] and m["record"]==c["record"] for m in g["missing_evidence"]) else ("none" if not c["evidence"] else "MISSING")
            more = f" (+{len(c['evidence'])-1})" if len(c["evidence"]) > 1 else ""
            w(f"| {c['role'].split('-')[0]} | {cell(c['id'])} | {c['result']} | {cell(c['exit_status'])} | `{cell(c['command'][:140])}` | `{cell(ev)}`{more} | {ok} |")
        w("")
    w(f"### {g['gate']} release-audit tests (gate record `tests[]`, {len(g['gate_tests'])})")
    w("")
    w("| Test | Result | Evidence (first) |")
    w("|---|---|---|")
    for t in g["gate_tests"]:
        ev = t["evidence"][0] if t["evidence"] else ""
        w(f"| {cell(t['name'][:160])} | {t['result']} | `{cell(ev)}` |")
    w("")
    w(f"### {g['gate']} tests that could not run, and disclosures ({len(g['not_run_or_blocked'])})")
    w("")
    if not g["not_run_or_blocked"]:
        w("None recorded.")
    else:
        w("| Source | Role | Record | Check | Result | Reason (excerpt) |")
        w("|---|---|---|---|---|---|")
        for x in g["not_run_or_blocked"]:
            w(f"| {x['source']} | {x['role']} | `{x['record']}` | {cell(x['check'])} | {x['result']} | {cell(x['reason_excerpt'])} |")
    w("")
sys.stdout.write("\n".join(L) + "\n")
