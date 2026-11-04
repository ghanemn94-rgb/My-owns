#!/usr/bin/env python3
"""One-off: insert the measured file-level budget (F-DG6-144) into each product spec that still has tests on the
default 30 s. Comment-and-setTimeout block only; no assertion or wait is touched."""
import re, sys
R2 = "docs/delivery/test-evidence/DG6/qa/round-2/06-e2e-product-*.log"
PLAN = {  # spec: (budget s, worst default-budget test in the QA round-2 product runs, its worst duration, note)
 "fed3-automation": (60, "Failure queue at 1280 px", "8.9 s", ""),
 "p2-journeys": (60, "the slowest default-budget test", "28.0 s", ""),
 "p3-g4-refusal": (60, "the default-budget test", "16.0 s", ""),
 "p3-journeys": (75, "2a. prioritization", "32.7 s", "a timeout at the default 30 s (06-e2e-product-unset-en.log and 06b), so at least that long; 29.2 s with a 120 s budget (06c)"),
 "p3-prioritization-roadmap": (75, "lead: ranked table", "32.8 s", "a timeout at the default 30 s (06-e2e-product-unset-en.log), so at least that long"),
 "p3-ui-completion": (60, "the slowest default-budget test", "16.8 s", ""),
 "p4-benefits": (90, "8. Auditor read-only", "43.3 s", "timeouts at the default 30 s in 3 of 4 full runs, 43.3 s with a 120 s budget (06c)"),
 "p4-change-phases": (60, "the slowest default-budget test", "28.6 s", ""),
 "p4-dashboards": (60, "the slowest default-budget test", "23.9 s", ""),
 "p4-gates-closure": (75, "6. Modular G3", "30.8 s", "a timeout at the default 30 s (06-e2e-product-unset-en.log and 06b), so at least that long; 26.0 s with a 120 s budget (06c)"),
 "p4-kpi-unit": (60, "the slowest default-budget test", "17.3 s", ""),
 "p4-percentage-kpi": (60, "the default-budget test", "16.3 s", ""),
 "p4-raid-governance": (60, "the slowest default-budget test", "23.6 s", ""),
 "p4-value-rag-lines": (60, "the default-budget test", "16.6 s", ""),
}
for name, (b, who, worst, note) in PLAN.items():
    p = "apps/web/e2e/%s.spec.ts" % name
    src = open(p, encoding="utf-8").read().split("\n")
    assert not any(re.match(r"^test\.setTimeout\(", l) for l in src), p
    idx = next((i for i, l in enumerate(src) if l.startswith("test.describe.configure(")), None)
    if idx is None:  # after the last top-level import statement
        idx = max(i for i, l in enumerate(src) if l.startswith("import ") or l.startswith("} from "))
    block = [
        "",
        "// Budget (F-DG6-144, the F-DG5-145/146 carry-forward of D-193; p6-work-split §2 rules 13 and 15): %d s for" % b,
        "// every test and hook in this file that does not set its own. Measured in the DG6 QA round-2 full product",
        "// runs at a 1-minute load of 11-21 on 4 CPUs (%s): %s took %s%s." % (R2, who, worst, (", " + note) if note else ""),
        "// T-DG6-FE-Z1's loaded full runs (both projects, both locale settings, CPU spinners): see",
        "// docs/delivery/handbacks/DG6/T-DG6-FE-Z1-evidence/budget-table.txt. The budget is at least 2x the worst of",
        "// these, rounded up to 15 s, and never below 60 s.",
        "test.setTimeout(%d_000);" % b,
    ]
    src[idx + 1:idx + 1] = block
    open(p, "w", encoding="utf-8").write("\n".join(src))
    print("inserted", p, "after line", idx + 1)
