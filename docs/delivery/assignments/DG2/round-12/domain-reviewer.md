# DG2 gate review — domain-reviewer (round 12)

Task ID: `T-DG2-REV-DOM-R12`. You are the independent domain reviewer of the **repaired** DG2 candidate. You did not implement any DG2 requirement and are read-only to the implementation.

## Candidate
- **candidate_id:** `sha256:5dfecce44b9d7d4ded6ca45968c9e2686d1c011cdd7c906ba3dc9974bbdf92b8`. Verify it with `node tools/gates/candidate.mjs --stage DG2` (552 files) on a complete clone.
- **manifest:** `docs/delivery/candidates/DG2/5dfecce44b9d7d4d.manifest.json`.
- **source_commit:** `8488e7a4`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- DG1 is APPROVED. `node tools/gates/validate.mjs --historical --stage DG1` must pass.

## Context
Your reviews from round 3 through round 11 passed. You have **no open finding to verify**, so do not write a `.verifications.json`.

Since round 11, repairs for the other reviewers' findings changed the product (D-072):
- A file upload is now received before the database is touched, so slow uploads can no longer block other users.
- An interrupted request now gets a clear validation answer instead of a server error.
- A React warning in the team assignment dialog was fixed.

Nothing in the business logic or the playbook content changed. This round is a **full re-review** of the same scope. Confirm that evidence upload (a normal file still uploads and downloads unchanged, in EN and AR), the team assignment dialog, bilingual behaviour and the gate logic are unaffected.

## Evidence honesty (round-10 audit condition 1)
In your record, report every non-zero exit, failed suite, hook timeout or error line that appears in any log you cite. Explain each one, whatever its cause, in the check's `actual`.
- A check with an unexplained failure in its evidence cannot be PASS.
- A probe that exits non-zero "by design" must say exactly which assertions failed and why.

## What to review — source fidelity and operating logic (full review)
Verify that P2 is faithful to the Business Transformation Playbook and the master prompt. Read `docs/source/playbook.md` and cite B-blocks, and read ADRs 0015-0020. Cover:
- **Registers and charter**
  - T01-T04 source-faithful columns (REQ-PB-026/034/039/043).
  - The Charter's 14 fields and the composed four-part thesis, B0037, flagged incomplete when a part is blank (REQ-PB-029/030).
  - The five scope sanity checks, B0038-B0043 (REQ-PB-031).
  - Exactly one current North Star (REQ-PB-033).
- **Outcomes and guardrails**
  - The 3-5 top-outcome warning (REQ-PB-035).
  - The good-outcome test (REQ-PB-036).
  - Strategic guardrails, with G2 blocked at zero (REQ-PB-037).
- **Diagnose and design**
  - The 10 seeded TOM dimensions (REQ-PB-038).
  - The six diagnostic workstreams (REQ-PB-023).
  - The capability heatmap (REQ-PB-024).
  - Journey and process maps (REQ-PB-025).
  - The TOM canvas and the per-dimension view (REQ-PB-041/042, REQ-S05-003).
- **Gates, modes and roles**
  - Product gates G1/G2/G3 advance **sequentially** with B0023 names (REQ-PB-016/017/018, REQ-S04-003/004/005).
  - End-to-End and Modular modes with the **verbatim** B0009 guidance (REQ-PB-003).
  - The six governance roles with the B0018 text (REQ-PB-012).

Invariants:
- The brand is provisional, and nothing claims PMI or Mobily certification.
- AR is RTL and EN is LTR.
- Money uses decimals.
- Unknown/Stale is never shown as 0 or green.
- Unquantified value pools are labelled.
- **Product gates G1-G6 are business approvals and never imply or touch the engineering DG0-DG7 gates.**

## Checks — real output; a missing tool or database is BLOCKED; run on Node 22 and 24
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm test` on both Node versions.
- `pnpm --filter @mth/design-tokens run check:contrast`
- A live scenario on a running stack (disposable PostgreSQL, synthetic data, unique ports):
  - Create a transformation, walk Diagnose→Define→Design, and observe G1, G2 and G3 decisions.
  - Enter Arabic charter text containing RLM marks and confirm it is accepted verbatim.
  - Confirm that an invisible-only value is refused with the localized message in EN and AR.
  - Upload a file as evidence and confirm it is stored and downloadable unchanged.

Put evidence under `docs/delivery/test-evidence/DG2/domain/round-12/`. Keep screenshots to the ones you cite.

## Requirements to check (record EXACTLY these 26)
`REQ-PB-003, REQ-PB-012, REQ-PB-016, REQ-PB-017, REQ-PB-018, REQ-PB-023, REQ-PB-024, REQ-PB-025, REQ-PB-026, REQ-PB-029, REQ-PB-030, REQ-PB-031, REQ-PB-033, REQ-PB-034, REQ-PB-035, REQ-PB-036, REQ-PB-037, REQ-PB-038, REQ-PB-039, REQ-PB-041, REQ-PB-042, REQ-PB-043, REQ-S04-003, REQ-S04-004, REQ-S04-005, REQ-S05-003`.

## Environmental residuals — NOT BLOCKED gate checks
Record these as PASS on the offline/config surface, with a note naming each residual. Never record them as BLOCKED gate checks:
- live registry (D-057);
- live CI (D-058);
- Keycloak (D-049).

## Record format (MANDATORY)
Write `docs/delivery/reviews/DG2/round-12/domain-reviewer.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-12/domain-reviewer.md` (bare path);
- `candidate_id` above;
- `reviewer_role: domain-reviewer`, `round: 12`, `stage_id: DG2`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the 26 ids;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if every requirement is faithfully met, nothing has regressed and nothing Critical, High or mandatory is unresolved. Otherwise FAIL.

## Finding record format — STRICT (use YOUR id range only)
Ids for any NEW finding you raise: **F-DG2-450 to F-DG2-459**, in order. Never reuse another id. Other reviewers have their own ranges; 140-152, 160, 180-181, 201-220, 230-231, 260, 290, 310, 320, 340, 350-351, 410-412 and 430 are taken.

If you raise findings, write `docs/delivery/reviews/DG2/round-12/domain-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. Mirror `docs/delivery/reviews/DG2/round-2/domain-reviewer.findings.json` field-for-field. Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`
- `stage_id` ("DG2")
- `requirement`
- `severity` (Critical|High|Medium|Low)
- `mandatory_violation` (bool)
- `title`, `reproduction`, `expected`, `actual`
- `evidence` (array of repository paths)
- `reported_by` ("domain-reviewer")
- `reported_in` ("docs/delivery/reviews/DG2/round-12/domain-reviewer.json")
- `owner` (implementer role)
- `status` ("OPEN")
- `history` (`[{at, status:"OPEN", note}]`)

If you raise none, set `findings: []` and write no findings sidecar.

## Handback
Write a brief handback at `docs/delivery/handbacks/DG2/T-DG2-REV-DOM-R12-domain-reviewer.md`.
