# DG2 gate review — domain-reviewer (round 1)

Task ID: `T-DG2-REV-DOM-R1`. Independent domain reviewer of the frozen **DG2** candidate. You did not implement any DG2 requirement; read-only to the implementation.

## Candidate
- **candidate_id:** `sha256:8ef26b710e343ed3535934904bccd677eab87894bb2cb62d5fb7677d6a95355b` — verify with `node tools/gates/candidate.mjs --stage DG2` (must match; 513 files). Complete clone (not shallow).
- **manifest:** `docs/delivery/candidates/DG2/8ef26b710e343ed3.manifest.json`. **source_commit:** `98a8d99`. Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 floor.
- **Preceding gate:** DG1 is APPROVED; `node tools/gates/validate.mjs --historical --stage DG1` must pass (run it, report it).

## What to review — source fidelity and operating logic (playbook + master prompt)
Verify the P2 implementation is faithful to the Business Transformation Playbook and the master prompt, for the diagnosis/definition/design domain. Read `docs/source/playbook.md` (cite B-blocks) and the ADRs 0015-0020. Check in particular:
- **Templates source-faithful:** T01 Current-State Diagnostic (6 pre-seeded dimensions, Confidence H/M/L, Impact SAR or KPI — REQ-PB-026), T02 Outcome & KPI Tree (7 columns, target date required — REQ-PB-034), T03 TOM Gap Matrix (6 columns, dimension required, T04 link — REQ-PB-039), T04 Design Decision Log (7 columns, IDs D-01…, Status Open default, options A/B/C — REQ-PB-043).
- **Charter (REQ-PB-029/030/031):** 14 source fields, the four-part thesis, the five scope sanity checks, versioned with history retained.
- **Direction (REQ-PB-033/035/036/037/038):** exactly one current North Star (one sentence; second active → 409); the 3–5 top-outcome warning; **the good outcome test applied to every outcome (REQ-PB-036) — an outcome like "Launch new app" with no KPI must fail with reasons, and G2 readiness must list the failing outcomes**; strategic guardrails as non-negotiables (G2 blocked with zero); the 10 TOM dimensions seeded with design questions.
- **Diagnose/Design (REQ-PB-023/024/025/041/042, REQ-S05-003):** the six diagnostic workstreams with key questions; the editable capability heatmap (build/buy/partner); journey/process maps (steps, actors, handoffs, systems, controls, pain points, cycle time); the TOM canvas with the ten source boxes and, per dimension, current/target/gaps/owner/evidence/dependencies/decisions; workshop mode converting unresolved items into decisions/actions.
- **Phase procedures + product gates (REQ-PB-016/017/018, REQ-S04-003/004/005):** the Diagnose→G1, Define→G2, Design→G3 procedures and decisions; G1 requires diagnostic+baseline+root-causes+value-pools+initial charter (submission without a charter rejected); approval advances the phase. **Confirm the product gates G1–G3 are presented as business approvals and never imply or touch the engineering DG0–DG7 gates.**
- **Modes (REQ-PB-003):** End-to-End and Modular offered on create; the **verbatim** "When to use"/"How" guidance from the playbook mode table (B0009); Modular requires an entry phase.
- **Roles/accountabilities (REQ-PB-012):** the six governance roles seeded with their B0018 accountability text (verbatim, `isSourceText`), assignable per transformation; the accountability text matches B0018.
- **Invariants:** provisional brand provenance (`#0078FF`, no official Mobily logo/colour); no official PMI/Mobily certification claim; AR-RTL + EN-LTR for every user-facing string; decimal money/rates; Unknown/Stale never 0/green; unquantified value pools labelled, never 0.

## Checks (real output; a missing tool/DB is BLOCKED) — Node 22 and 24
`pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm test` (both Node versions), `pnpm --filter @mth/design-tokens run check:contrast`, and a live scenario on the running stack (create a transformation; walk Diagnose→Define→Design; observe a G1 decision on synthetic data). Evidence under `docs/delivery/test-evidence/DG2/domain/round-1/`.

## Requirements to check (record EXACTLY these)
`REQ-PB-003`, `REQ-PB-012`, `REQ-PB-016`, `REQ-PB-017`, `REQ-PB-018`, `REQ-PB-023`, `REQ-PB-024`, `REQ-PB-025`, `REQ-PB-026`, `REQ-PB-029`, `REQ-PB-030`, `REQ-PB-031`, `REQ-PB-033`, `REQ-PB-034`, `REQ-PB-035`, `REQ-PB-036`, `REQ-PB-037`, `REQ-PB-038`, `REQ-PB-039`, `REQ-PB-041`, `REQ-PB-042`, `REQ-PB-043`, `REQ-S04-003`, `REQ-S04-004`, `REQ-S04-005`, `REQ-S05-003`.

## Environmental residuals — do NOT record as BLOCKED gate checks
Live-registry install (REQ-DLV-042 AC-1, **D-057**), live GitHub-Actions CI (REQ-DLV-025 A24, **D-058**) and keycloak image pinning (**D-049**) are documented residuals; record the available offline/config surface PASS and note the live effect as the residual. A BLOCKED check fails the gate round; only a genuinely unverifiable required surface is a FAIL to raise.

## Record format (MANDATORY)
Write `docs/delivery/reviews/DG2/round-1/domain-reviewer.json`:
- `assignment`: exactly `docs/delivery/assignments/DG2/round-1/domain-reviewer.md` (bare path).
- `candidate_id` above; `reviewer_role: domain-reviewer`; `round: 1`; `stage_id: DG2`.
- `checks_run[]`: each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`.
- `requirements_checked[]`: exactly the ids above.
- `findings[]`: only NEW findings; if non-empty also write `domain-reviewer.findings.json` (`reported_by: domain-reviewer`). None → empty, no sidecar.
- `verdict`: PASS only if every requirement is faithfully met, no regression, and no unresolved Critical/High/mandatory; else FAIL.
