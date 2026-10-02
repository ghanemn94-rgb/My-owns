# DG2 gate review — domain-reviewer (round 2)

Task ID: `T-DG2-REV-DOM-R2`. Independent domain reviewer of the frozen **DG2** candidate (first domain review in this gate; the round-1 domain runs produced schema-invalid records and were dropped — follow the **Finding record format** below EXACTLY). You did not implement any DG2 requirement; read-only to the implementation.

## Candidate
- **candidate_id:** `sha256:089a2a2fbe3675019b0c5faeb1cf66fd4ea3f7235fae2c2b4ddb5aaef6c9be69` — verify `node tools/gates/candidate.mjs --stage DG2` (517 files). Complete clone. **manifest:** `docs/delivery/candidates/DG2/089a2a2fbe367501.manifest.json`. **source_commit** `eb8163e2`. Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 floor. DG1 APPROVED; `validate --historical --stage DG1` must pass.

## What to review — source fidelity and operating logic
Verify P2 is faithful to the Business Transformation Playbook and the master prompt (read `docs/source/playbook.md`, cite B-blocks; ADRs 0015-0020). Cover: T01-T04 source-faithful columns (REQ-PB-026/034/039/043); the Charter 14 fields + the composed four-part thesis (B0037, flagged incomplete when a part is empty — REQ-PB-029/030/031); exactly one current North Star (one sentence; the charter shows the current one, never a superseded sentence as current — REQ-PB-033); the 3-5 top-outcome warning (REQ-PB-035); the good-outcome test applied to every outcome with G2 listing failing ones (REQ-PB-036); strategic guardrails non-negotiable, G2 blocked at zero (REQ-PB-037); the 10 TOM dimensions seeded (REQ-PB-038); six diagnostic workstreams (REQ-PB-023); capability heatmap (REQ-PB-024); journey/process maps (REQ-PB-025); TOM canvas + per-dimension view (REQ-PB-041/042, REQ-S05-003); product gates G1/G2/G3 with **sequential** phase advance (G3 not before G2; no phase skip — REQ-PB-016/017/018, REQ-S04-003/004/005); End-to-End + Modular with the **verbatim** B0009 mode guidance on create (REQ-PB-003); the six governance roles with B0018 accountability text, assignable per transformation (REQ-PB-012). Invariants: provisional brand; no PMI/Mobily cert claim; AR-RTL + EN-LTR; decimal money; Unknown/Stale never 0/green; unquantified value pools labelled; **product gates G1-G6 are business approvals and never imply or touch the engineering DG0-DG7 gates.**

## Checks (real output; missing tool/DB is BLOCKED) — Node 22 and 24
`pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm test` (both), `pnpm --filter @mth/design-tokens run check:contrast`, plus a live scenario on the running stack (create a transformation; walk Diagnose→Define→Design; observe a G1 then G2 decision on synthetic data). Evidence under `docs/delivery/test-evidence/DG2/domain/round-2/`.

## Requirements to check (record EXACTLY these 26)
`REQ-PB-003, REQ-PB-012, REQ-PB-016, REQ-PB-017, REQ-PB-018, REQ-PB-023, REQ-PB-024, REQ-PB-025, REQ-PB-026, REQ-PB-029, REQ-PB-030, REQ-PB-031, REQ-PB-033, REQ-PB-034, REQ-PB-035, REQ-PB-036, REQ-PB-037, REQ-PB-038, REQ-PB-039, REQ-PB-041, REQ-PB-042, REQ-PB-043, REQ-S04-003, REQ-S04-004, REQ-S04-005, REQ-S05-003`.

## Environmental residuals — NOT BLOCKED gate checks
Live-registry (D-057), live-CI (D-058), keycloak (D-049): offline/config surface PASS + note the residual; never a BLOCKED gate check.

## Record format (MANDATORY)
`docs/delivery/reviews/DG2/round-2/domain-reviewer.json`: `assignment` = exactly `docs/delivery/assignments/DG2/round-2/domain-reviewer.md` (bare path); `candidate_id` above; `reviewer_role: domain-reviewer`; `round: 2`; `stage_id: DG2`; `checks_run[]` each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`; `requirements_checked[]` exactly the 26 ids; `findings[]` only NEW finding **ids** you raise (strings).

### Finding record format — STRICT (the round-1 domain runs were rejected for not following this)
If you raise findings, ALSO write `docs/delivery/reviews/DG2/round-2/domain-reviewer.findings.json` = `{ "findings": [ <objects> ] }`. **Mirror `docs/delivery/reviews/DG2/round-1/code-security-reviewer.findings.json` field-for-field.** Each finding object has EXACTLY these keys (no others — `locations` is NOT allowed):
`id` (string `^F-DG2-[0-9]{3}$`; use **F-DG2-143**, then 144, 145, … — 140-142 and 201-206 are taken), `stage_id` ("DG2"), `requirement` (REQ id), `severity` ("Critical"|"High"|"Medium"|"Low"), `mandatory_violation` (bool), `title`, `reproduction`, `expected`, `actual`, `evidence` (array of paths), `reported_by` ("domain-reviewer"), `reported_in` ("docs/delivery/reviews/DG2/round-2/domain-reviewer.json"), `owner` (implementer role), `status` ("OPEN"), `history` (`[{at, status:"OPEN", note}]`).
If you raise NO findings, leave `findings: []` and write no sidecar.
- `verdict`: PASS only if every requirement is faithfully met, no regression, and no unresolved Critical/High/mandatory; else FAIL.

## Handback
`docs/delivery/handbacks/DG2/T-DG2-REV-DOM-R2-domain-reviewer.md` (brief).
