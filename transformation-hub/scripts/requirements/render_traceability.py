#!/usr/bin/env python3
"""Render docs/requirements/requirements-traceability.md from requirements.yaml.

Columns follow spec §22: Requirement → Business outcome → Module → UI/API → Data entities → Security rule →
Acceptance test → Phase → Evidence → Status. Also prints coverage statistics (status by phase, AT coverage).
"""
import collections, pathlib, sys
try:
    import yaml
except ImportError:
    sys.exit("pyyaml is required (pip install pyyaml)")

root = pathlib.Path(__file__).resolve().parents[2]
reqs = yaml.safe_load((root / "docs/requirements/requirements.yaml").read_text())

def cell(v):
    if isinstance(v, list):
        v = "; ".join(str(x) for x in v)
    return str(v or "").replace("|", "\\|").replace("\n", " ")

by_phase = collections.defaultdict(collections.Counter)
at_refs = collections.defaultdict(list)
for r in reqs:
    by_phase[r["phase"]][r["status"]] += 1
    for t in r.get("acceptance_tests") or []:
        if str(t).startswith("AT-"):
            at_refs[str(t)[:5]].append(r["id"])

out = ["# Requirements traceability matrix", "",
       "> Generated from `docs/requirements/requirements.yaml` by `scripts/requirements/render_traceability.py` — do not edit by hand.",
       f"> {len(reqs)} requirements. Status vocabulary: Planned · Implemented · Tested · Simulated · Not configured · Blocked · Deferred.", "",
       "## Status by phase", "", "| Phase | " + " | ".join(["Planned", "Implemented", "Tested", "Simulated", "Not configured", "Blocked", "Deferred"]) + " | Total |",
       "|---|" + "---|" * 8]
for ph in sorted(by_phase):
    c = by_phase[ph]
    out.append(f"| {ph} | " + " | ".join(str(c.get(s, 0)) for s in ["Planned", "Implemented", "Tested", "Simulated", "Not configured", "Blocked", "Deferred"]) + f" | {sum(c.values())} |")
out += ["", "## Acceptance scenario coverage", "", "| AT | Requirements |", "|---|---|"]
for i in range(1, 31):
    k = f"AT-{i:02d}"
    out.append(f"| {k} | {', '.join(at_refs.get(k, [])) or '**none**'} |")
out += ["", "## Matrix", "", "| Requirement | Title | Business outcome | Module | UI / API | Data entities | Security rule | Acceptance tests | Phase | Evidence | Status |",
        "|---|---|---|---|---|---|---|---|---|---|---|"]
for r in reqs:
    uiapi = "; ".join([*(r.get("ui") or []), *(r.get("api") or [])])
    out.append("| " + " | ".join([r["id"], cell(r["title"]), cell(r["business_outcome"]), cell(r["module"]), cell(uiapi), cell(r.get("entities")),
                                 cell(r.get("security_rule")), cell(r.get("acceptance_tests")), cell(r["phase"]), cell(r.get("evidence")), cell(r["status"])]) + " |")
(root / "docs/requirements/requirements-traceability.md").write_text("\n".join(out) + "\n")
missing = [f"AT-{i:02d}" for i in range(1, 31) if f"AT-{i:02d}" not in at_refs]
print(f"rendered {len(reqs)} requirements; AT coverage {30 - len(missing)}/30" + (f"; missing {missing}" if missing else ""))
