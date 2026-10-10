#!/usr/bin/env python3
# Applies ONE named mutation to the disposable copy (argv[1] = copy root, argv[2] = mutation id). Each mutation must
# match its anchor exactly once, otherwise it exits 2 (the mutation was not applied, so the run would prove nothing).
import sys, pathlib

root = pathlib.Path(sys.argv[1])
mid = sys.argv[2]

M = {
    # REQ-PB-010: the T10 scorecard serves a stale copy of the initiative name (first name seen, cached per id).
    "PB010-scorecard-stale-copy": [
        ("apps/api/src/modules/portfolio/dashboard-facts.ts",
         "    name: i.name,\n",
         "    name: (__qaNameCopy.has(i.id) ? __qaNameCopy.get(i.id)! : (__qaNameCopy.set(i.id, i.name), i.name)),\n"),
        ("apps/api/src/modules/portfolio/dashboard-facts.ts",
         "const dateText = ",
         "const __qaNameCopy = new Map<string, string>();\nconst dateText = "),
    ],
    # REQ-PB-010: the traceability view labels the initiative node from a stale copy.
    "PB010-traceability-stale-copy": [
        ("apps/api/src/modules/reporting/traceability.ts",
         "      code: r.code,\n      label: r.name,\n      status: r.status,\n      shown: r.status !== \"cancelled\",",
         "      code: r.code,\n      label: (__qaNameCopy.has(r.id) ? __qaNameCopy.get(r.id)! : (__qaNameCopy.set(r.id, r.name), r.name)),\n      status: r.status,\n      shown: r.status !== \"cancelled\","),
        ("apps/api/src/modules/reporting/traceability.ts",
         "const graphQuery = z",
         "const __qaNameCopy = new Map<string, string>();\nconst graphQuery = z"),
    ],
    # REQ-PB-010: the scorecard lists a code but no name (the area stops reading the canonical name).
    "PB010-scorecard-label-code": [
        ("apps/api/src/modules/reporting/dashboards/engine.ts",
         "        code: row.fact.code,\n        label: row.fact.name,",
         "        code: row.fact.code,\n        label: row.fact.code,"),
    ],
    # REQ-S03-004 (A02): a T03 gap (Design-phase draft) is refused while G2 is not approved.
    "S03004-design-draft-blocked-before-g2": [
        ("apps/api/src/modules/transformations/register-kit.ts",
         "          if (spec.check) await spec.check(values, ctx, null);\n",
         "          if (spec.table === \"tom_gap\") {\n"
         "            const g2 = await tx.selectFrom(\"gate_instance\").select(\"status\").where(\"transformation_id\", \"=\", transformationId).where(\"gate_code\", \"=\", \"G2\").executeTakeFirst();\n"
         "            if (g2?.status !== \"approved\") throw new HttpProblem({ status: 422, type: \"urn:mth:problem:invalid-transition\", code: \"gate.g2_not_approved\", title: \"Invalid transition\", detail: \"Design drafts need G2.\" });\n"
         "          }\n"
         "          if (spec.check) await spec.check(values, ctx, null);\n"),
    ],
    # REQ-S03-004 (A08): before G5, scaling is refused with the wrong code (not naming G5).
    "S03004-pre-g5-wrong-code": [
        ("apps/api/src/modules/workflows/scale.ts",
         "if (!decision) throw scaleRefusals.g5NotApproved();",
         "if (!decision) throw scaleRefusals.outsideScope();"),
    ],
    # REQ-S03-004 (A08): the refusal no longer names G5.
    "S03004-pre-g5-detail-without-g5": [
        ("apps/api/src/modules/workflows/scale.ts",
         "\"Scaling requires the G5 (Scale) business approval, which is not approved for this transformation.\"",
         "\"Scaling requires the Scale business approval, which is not approved for this transformation.\""),
    ],
    # REQ-S03-004 (A08): an approved G5 never enables scaling.
    "S03004-g5-approval-ignored": [
        ("apps/api/src/modules/workflows/scale.ts",
         "    .where(\"gate_code\", \"=\", \"G5\")\n    .where(\"outcome\", \"=\", \"approved\")",
         "    .where(\"gate_code\", \"=\", \"G5\")\n    .where(\"outcome\", \"=\", \"rejected\")"),
    ],
}

for path, old, new in M[mid]:
    p = root / path
    s = p.read_text()
    n = s.count(old)
    if n != 1:
        print(f"ANCHOR {path}: {n} matches, mutation {mid} NOT applied")
        sys.exit(2)
    p.write_text(s.replace(old, new))
    print(f"applied {mid}: {path}")
