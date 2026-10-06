# DG2 gate review — domain-reviewer (round 4)

Task ID: `T-DG2-REV-DOM-R4`. You are the independent domain reviewer of the **repaired** DG2 candidate. You did not implement any DG2 requirement and you are read-only to the implementation.

## Candidate
- **candidate_id:** `sha256:29ced0ed896ab9bf559e15dbdb39495b3da7a60c170989631ad9caf9a792ce58`. Verify it with `node tools/gates/candidate.mjs --stage DG2` (521 files). Complete clone.
- **manifest:** `docs/delivery/candidates/DG2/29ced0ed896ab9bf.manifest.json`.
- **source_commit:** `e37f6ea4`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- DG1 is APPROVED. `node tools/gates/validate.mjs --historical --stage DG1` must pass.

## Context
Your round-3 review passed, and your three findings (F-DG2-150/151/152) are CLOSED_VERIFIED. You have **no open finding to verify**, so do not write a `.verifications.json`. Since round 3 the repairs for the other reviewers' findings changed the product (D-064):
- F-DG2-160: free text, names and reasons that have no *visible* content (whitespace, format characters, invisible fillers) are rejected and never count as present.
- F-DG2-210: every P2 web form shows an inline EN/AR "Enter some text; spaces alone are not a value." for such input and sends nothing.
- F-DG2-211: the form error banner was made accessible.

This round is a **full re-review** of the same scope, with particular attention to whether these changes still respect the playbook:
- Does any playbook form or field legitimately accept text that the new rule now refuses?
- Is the user guidance clear in both languages?
- Do the B0041 pre-check, G1-G3 readiness and the thesis "incomplete" flag still behave as the source intends?

## What to review — source fidelity and operating logic (full review)
Verify that P2 is faithful to the Business Transformation Playbook and the master prompt. Read `docs/source/playbook.md` and cite B-blocks; read ADRs 0015-0020. Cover:
- **Registers.**
  - T01-T04 source-faithful columns (REQ-PB-026/034/039/043).
- **Charter and direction.**
  - The Charter's 14 fields and the composed four-part thesis, B0037, flagged incomplete when a part is blank (REQ-PB-029/030).
  - The five scope sanity checks, B0038-B0043 (REQ-PB-031).
  - Exactly one current North Star (REQ-PB-033).
  - The 3-5 top-outcome warning (REQ-PB-035).
  - The good-outcome test (REQ-PB-036).
  - Strategic guardrails, with G2 blocked at zero (REQ-PB-037).
- **Diagnose and design.**
  - The 10 TOM dimensions are seeded (REQ-PB-038).
  - The six diagnostic workstreams (REQ-PB-023).
  - The capability heatmap (REQ-PB-024).
  - Journey and process maps (REQ-PB-025).
  - The TOM canvas and the per-dimension view (REQ-PB-041/042, REQ-S05-003).
- **Gates and governance.**
  - Product gates G1/G2/G3 advance **sequentially** with B0023 names (REQ-PB-016/017/018, REQ-S04-003/004/005).
  - End-to-End and Modular modes, with the **verbatim** B0009 guidance (REQ-PB-003).
  - The six governance roles with the B0018 text (REQ-PB-012).

Invariants:
- The brand is provisional, and nothing claims PMI or Mobily certification.
- AR is RTL and EN is LTR.
- Money uses decimals.
- Unknown/Stale is never shown as 0 or green.
- Unquantified value pools are labelled.
- **Product gates G1-G6 are business approvals and never imply or touch the engineering DG0-DG7 gates.**

## Checks — real output; a missing tool or DB is BLOCKED; run on Node 22 and 24
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm test` on both Node versions
- `pnpm --filter @mth/design-tokens run check:contrast`
- A live scenario on a running stack (disposable PostgreSQL, synthetic data, unique ports): create a transformation, walk Diagnose→Define→Design, and observe G1, G2 and G3 decisions. Include at least one attempt to enter blank or invisible-only text in a charter field, to see the user experience in EN and AR.

Put evidence under `docs/delivery/test-evidence/DG2/domain/round-4/`.

## Requirements to check (record EXACTLY these 26)
`REQ-PB-003, REQ-PB-012, REQ-PB-016, REQ-PB-017, REQ-PB-018, REQ-PB-023, REQ-PB-024, REQ-PB-025, REQ-PB-026, REQ-PB-029, REQ-PB-030, REQ-PB-031, REQ-PB-033, REQ-PB-034, REQ-PB-035, REQ-PB-036, REQ-PB-037, REQ-PB-038, REQ-PB-039, REQ-PB-041, REQ-PB-042, REQ-PB-043, REQ-S04-003, REQ-S04-004, REQ-S04-005, REQ-S05-003`.

## Environmental residuals — NOT BLOCKED gate checks
Record each of these as PASS on the offline/config surface, with a note naming the residual. Never record any of them as a BLOCKED gate check:
- live registry (D-057);
- live CI (D-058);
- Keycloak (D-049).

## Record format (MANDATORY)
Write `docs/delivery/reviews/DG2/round-4/domain-reviewer.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-4/domain-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: domain-reviewer`;
- `round: 4`;
- `stage_id: DG2`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the 26 ids;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if every requirement is faithfully met, nothing has regressed, and nothing Critical, High or mandatory is unresolved. Otherwise FAIL.

## Finding record format — STRICT (use YOUR id range only)
Ids for any NEW finding you raise: **F-DG2-190 to F-DG2-199**, used in order. Never reuse another id. Other reviewers have their own ranges, and 140-152, 160 and 201-211 are taken.

If you raise findings, write `docs/delivery/reviews/DG2/round-4/domain-reviewer.findings.json` as `{ "schema_version": 1, "findings": [ ... ] }`. Mirror `docs/delivery/reviews/DG2/round-2/domain-reviewer.findings.json` field-for-field. Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`
- `stage_id` ("DG2")
- `requirement`
- `severity` (Critical|High|Medium|Low)
- `mandatory_violation` (bool)
- `title`, `reproduction`, `expected`, `actual`
- `evidence` (an array of repository paths)
- `reported_by` ("domain-reviewer")
- `reported_in` ("docs/delivery/reviews/DG2/round-4/domain-reviewer.json")
- `owner` (an implementer role)
- `status` ("OPEN")
- `history` (`[{at, status:"OPEN", note}]`)

If you raise none, set `findings: []` and write no findings sidecar.

## Handback
Write a brief handback at `docs/delivery/handbacks/DG2/T-DG2-REV-DOM-R4-domain-reviewer.md`.
