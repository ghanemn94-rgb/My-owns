# DG2 gate review — domain-reviewer (round 3)

Task ID: `T-DG2-REV-DOM-R3`. You are the independent domain reviewer of the **repaired** DG2 candidate. You did not implement any DG2 requirement and you are read-only to the implementation.

## Candidate
- **candidate_id:** `sha256:b98c44db7ef91295eec25a21cbd394a91890b01caeeb6bfd269eb1ee6d132be5`. Verify it with `node tools/gates/candidate.mjs --stage DG2` (519 files). Use a complete clone.
- **manifest:** `docs/delivery/candidates/DG2/b98c44db7ef91295.manifest.json`.
- **source_commit:** `9e13947e`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`, and 22.22.2 at `/opt/node22/bin`.
- DG1 is APPROVED. `node tools/gates/validate.mjs --historical --stage DG1` must pass.

## Verify your round-2 findings on THIS candidate
Reproduce each finding live on a running stack (disposable PostgreSQL, synthetic data, unique ports) and check the code.

- **F-DG2-150 (Medium, mandatory, REQ-PB-031 / B0041).** Claim: on a saved charter, an empty, null or whitespace-only Out of scope now makes "Are explicit exclusions documented?" fail. Check:
  - The result is `attention`, shown in the UI as the amber "Not supported by data" / "لا تدعمه البيانات" chip, with the detail "No explicit exclusions (out of scope) are documented, so this check fails." in EN and AR.
  - Non-blank text passes.
  - G1 readiness applies the same rule.
  - A whitespace-only value is now rejected with 400 `validation.blank` (D-063).
  - ADR-0017 §2 is updated.
- **F-DG2-151 (Low, REQ-PB-017 / B0023).** Claim: gate list cards and detail headings show the verbatim B0023 name once ("G2 - Direction" / "G2 - التوجّه"), in EN and AR.
- **F-DG2-152 (Low, REQ-S05-003).** Claim: the register's `screen_api` for REQ-S05-003 names the real contract (`GET …/tom-canvas`, `GET …/tom-canvas/{dimensionCode}`, DesignPage DimensionView). The analyst also corrected 15 other DG2 rows. Spot-check them against `docs/api/openapi.yaml`.

Write `docs/delivery/reviews/DG2/round-3/domain-reviewer.verifications.json` as `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`, with one entry per finding:
- If the fix is genuine: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`.
- Otherwise: `result: "FAIL"`, with the reason in `note`.

## What to re-review — source fidelity and operating logic (full review)
Verify that P2 is faithful to the Business Transformation Playbook and the master prompt. Read `docs/source/playbook.md` and cite B-blocks, and read ADRs 0015-0020. Cover:
- **Registers and charter**
  - T01-T04 source-faithful columns (REQ-PB-026/034/039/043).
  - The Charter's 14 fields and the composed four-part thesis, B0037, flagged incomplete when a part is empty or blank (REQ-PB-029/030).
  - The five scope sanity checks, B0038-B0043 (REQ-PB-031).
  - Exactly one current North Star; the charter never shows a superseded sentence as current (REQ-PB-033).
- **Outcomes and guardrails**
  - The 3-5 top-outcome warning (REQ-PB-035).
  - The good-outcome test, with G2 listing the failing outcomes (REQ-PB-036).
  - Strategic guardrails; G2 is blocked at zero (REQ-PB-037).
- **Diagnose and design**
  - The 10 TOM dimensions are seeded (REQ-PB-038).
  - Six diagnostic workstreams (REQ-PB-023).
  - The capability heatmap (REQ-PB-024).
  - Journey and process maps (REQ-PB-025).
  - The TOM canvas and the per-dimension view (REQ-PB-041/042, REQ-S05-003).
- **Product gates G1/G2/G3**
  - Advance is **sequential**: no G3 before G2 and no phase skip.
  - Gate names follow B0023 (REQ-PB-016/017/018, REQ-S04-003/004/005).
- **Modes and roles**
  - End-to-End and Modular, with the **verbatim** B0009 guidance (REQ-PB-003).
  - The six governance roles with the B0018 accountability text (REQ-PB-012).

Also judge two changes made since round 2:
- The blank-text rule (D-063). Does rejecting whitespace-only input ever conflict with the playbook's forms?
- The "Not supported by data" label for `attention` across the five pre-checks.

Invariants:
- The brand is provisional, and nothing claims PMI or Mobily certification.
- AR is RTL and EN is LTR.
- Money uses decimals.
- Unknown/Stale is never shown as 0 or green.
- Unquantified value pools are labelled.
- **Product gates G1-G6 are business approvals and never imply or touch the engineering gates DG0-DG7.**

## Checks — real output; a missing tool or DB is BLOCKED; run on Node 22 and 24
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm test` on both Node versions.
- `pnpm --filter @mth/design-tokens run check:contrast`
- A live scenario on the running stack: create a transformation, walk Diagnose→Define→Design, and observe G1, G2 and G3 decisions on synthetic data.

Put evidence under `docs/delivery/test-evidence/DG2/domain/round-3/`.

## Requirements to check (record EXACTLY these 26)
`REQ-PB-003, REQ-PB-012, REQ-PB-016, REQ-PB-017, REQ-PB-018, REQ-PB-023, REQ-PB-024, REQ-PB-025, REQ-PB-026, REQ-PB-029, REQ-PB-030, REQ-PB-031, REQ-PB-033, REQ-PB-034, REQ-PB-035, REQ-PB-036, REQ-PB-037, REQ-PB-038, REQ-PB-039, REQ-PB-041, REQ-PB-042, REQ-PB-043, REQ-S04-003, REQ-S04-004, REQ-S04-005, REQ-S05-003`.

## Environmental residuals — NOT BLOCKED gate checks
Record each of these as PASS on the offline/config surface, with a note naming the residual. None of them is ever a BLOCKED gate check:
- the live registry (D-057);
- live CI (D-058);
- Keycloak (D-049).

## Record format (MANDATORY)
Write `docs/delivery/reviews/DG2/round-3/domain-reviewer.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-3/domain-reviewer.md` (bare path);
- `candidate_id` above;
- `reviewer_role: domain-reviewer`;
- `round: 3`;
- `stage_id: DG2`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the 26 ids;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if your three findings verify CLOSED, every requirement is faithfully met, nothing has regressed, and nothing Critical, High or mandatory is unresolved. Otherwise FAIL.

## Finding record format — STRICT (use YOUR id range only)
Ids for any NEW finding you raise: **F-DG2-170 to F-DG2-179**, used in order. Never reuse another id. Other reviewers have their own ranges; 140-152 and 201-206 are taken.

If you raise findings, write `docs/delivery/reviews/DG2/round-3/domain-reviewer.findings.json` as `{ "schema_version": 1, "findings": [ ... ] }`. Mirror `docs/delivery/reviews/DG2/round-2/domain-reviewer.findings.json` field for field. Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`
- `stage_id` ("DG2")
- `requirement`
- `severity` (Critical|High|Medium|Low)
- `mandatory_violation` (bool)
- `title`, `reproduction`, `expected`, `actual`
- `evidence` (array of repository paths)
- `reported_by` ("domain-reviewer")
- `reported_in` ("docs/delivery/reviews/DG2/round-3/domain-reviewer.json")
- `owner` (an implementer role)
- `status` ("OPEN")
- `history` (`[{at, status:"OPEN", note}]`)

If you raise none, set `findings: []` and write no findings sidecar.

## Handback
Write a brief handback at `docs/delivery/handbacks/DG2/T-DG2-REV-DOM-R3-domain-reviewer.md`.
