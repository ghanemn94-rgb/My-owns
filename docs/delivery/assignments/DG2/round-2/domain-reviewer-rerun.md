# DG2 gate review — domain-reviewer (round 2, re-run)

Task ID: `T-DG2-REV-DOM-R2B`. Independent domain reviewer of the frozen **DG2** candidate. You did not implement any DG2 requirement; read-only to the implementation.

**Why this is a re-run.** The first round-2 domain run (`T-DG2-REV-DOM-R2`) wrote a schema-valid record, but the orchestrator's assignments told both it and the code-security reviewer to number new findings from F-DG2-143, so both raised a different `F-DG2-143`. Finding ids must be unique across the stage, so that run's commit was dropped (user-approved surgical rewrite; decision D-062). This was an orchestrator error, not a reviewer fault. Review the candidate in full and independently. **Your finding ids start at F-DG2-150** (see the record format).

## Candidate
- **candidate_id:** `sha256:089a2a2fbe3675019b0c5faeb1cf66fd4ea3f7235fae2c2b4ddb5aaef6c9be69` — verify with `node tools/gates/candidate.mjs --stage DG2` (517 files). Complete clone. **manifest:** `docs/delivery/candidates/DG2/089a2a2fbe367501.manifest.json`. **source_commit** `eb8163e2`. Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 floor. DG1 is APPROVED; `node tools/gates/validate.mjs --historical --stage DG1` must pass.

## What to review — source fidelity and operating logic
Verify that P2 is faithful to the Business Transformation Playbook and the master prompt. Read `docs/source/playbook.md` and cite B-blocks; also read ADRs 0015-0020. Cover:
- T01-T04 source-faithful columns (REQ-PB-026/034/039/043).
- The Charter's 14 fields and the composed four-part thesis: B0037, flagged incomplete when a part is empty (REQ-PB-029/030).
- The Charter **scope sanity checks** (B0041, REQ-PB-031).
- Exactly one current North Star, one sentence; the charter shows the current one and never shows a superseded sentence as current (REQ-PB-033).
- The 3-5 top-outcome warning (REQ-PB-035).
- The good-outcome test applied to every outcome, with G2 listing the failing ones (REQ-PB-036).
- Strategic guardrails are non-negotiable, and G2 is blocked at zero guardrails (REQ-PB-037).
- The 10 TOM dimensions are seeded (REQ-PB-038).
- The six diagnostic workstreams (REQ-PB-023), the capability heatmap (REQ-PB-024) and journey/process maps (REQ-PB-025).
- The TOM canvas and the per-dimension view (REQ-PB-041/042, REQ-S05-003).
- Product gates G1/G2/G3: **sequential** phase advance, G3 not before G2, no phase skip; check the gate names and titles against B0023 (REQ-PB-016/017/018, REQ-S04-003/004/005).
- End-to-End and Modular modes, with the **verbatim** B0009 mode guidance on create (REQ-PB-003).
- The six governance roles with the B0018 accountability text, assignable per transformation (REQ-PB-012).

Invariants:
- Provisional brand; no PMI or Mobily certification claim.
- AR-RTL and EN-LTR.
- Decimal money.
- Unknown/Stale is never shown as 0 or green.
- Unquantified value pools are labelled.
- **Product gates G1-G6 are business approvals and never imply or touch the engineering DG0-DG7 gates.**

### Prior observations to re-check independently
The dropped run recorded two observations. Reproduce each one yourself on this candidate and record it only if you confirm it. Use your own severity judgement and evidence. Do not copy the earlier wording. Everything else in this candidate is in scope as usual.
1. REQ-PB-031 / B0041: on a saved charter with an empty *Out of scope*, the scope sanity check "Are explicit exclusions documented?" reportedly returns `unknown` instead of failing. The acceptance criterion says an empty Out of scope makes that check fail.
2. REQ-PB-017 / B0023: the product-gate list and detail titles reportedly repeat the gate code, for example "G2 – G2 - Direction".

## Checks — real output; a missing tool or DB is BLOCKED; run on Node 22 and 24
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm test` (on both Node versions)
- `pnpm --filter @mth/design-tokens run check:contrast`
- A live scenario on a running stack with a disposable PostgreSQL, synthetic data and a unique port: create a transformation, walk Diagnose→Define→Design, and observe a G1 then a G2 decision.

Put evidence under `docs/delivery/test-evidence/DG2/domain/round-2/`.

## Requirements to check (record EXACTLY these 26)
`REQ-PB-003, REQ-PB-012, REQ-PB-016, REQ-PB-017, REQ-PB-018, REQ-PB-023, REQ-PB-024, REQ-PB-025, REQ-PB-026, REQ-PB-029, REQ-PB-030, REQ-PB-031, REQ-PB-033, REQ-PB-034, REQ-PB-035, REQ-PB-036, REQ-PB-037, REQ-PB-038, REQ-PB-039, REQ-PB-041, REQ-PB-042, REQ-PB-043, REQ-S04-003, REQ-S04-004, REQ-S04-005, REQ-S05-003`.

## Environmental residuals — NOT BLOCKED gate checks
These three are recorded as PASS on the offline/config surface, with a note naming the residual. They are never a BLOCKED gate check:
- live registry (D-057)
- live CI (D-058)
- Keycloak (D-049)

## Record format (MANDATORY)
Write `docs/delivery/reviews/DG2/round-2/domain-reviewer.json` with:
- `assignment` = exactly `docs/delivery/assignments/DG2/round-2/domain-reviewer-rerun.md` (bare path).
- `candidate_id` = the id above.
- `reviewer_role: domain-reviewer`, `round: 2`, `stage_id: DG2`.
- `checks_run[]`: each entry is `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`.
- `requirements_checked[]`: exactly the 26 ids above.
- `findings[]`: only the **ids** (strings) of NEW findings you raise.
- `verdict`: PASS only if every requirement is faithfully met, nothing has regressed, and nothing Critical, High or mandatory is unresolved. Otherwise FAIL.

### Finding record format — STRICT
If you raise findings, ALSO write `docs/delivery/reviews/DG2/round-2/domain-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ <objects> ] }`. **Mirror `docs/delivery/reviews/DG2/round-2/code-security-reviewer.findings.json` field-for-field.**

Each finding object has EXACTLY these keys, and no others (`locations` is NOT allowed):
- `id`: a string matching `^F-DG2-[0-9]{3}$`. **Use F-DG2-150, then 151, 152, … in order.** Never use 140-149 or 201-206; they are taken or reserved.
- `stage_id`: "DG2".
- `requirement`: a REQ id.
- `severity`: "Critical", "High", "Medium" or "Low".
- `mandatory_violation`: a bool.
- `title`, `reproduction`, `expected`, `actual`.
- `evidence`: an array of repository paths.
- `reported_by`: "domain-reviewer".
- `reported_in`: "docs/delivery/reviews/DG2/round-2/domain-reviewer.json".
- `owner`: an implementer role.
- `status`: "OPEN".
- `history`: `[{at, status:"OPEN", note}]`.

If you raise NO findings, leave `findings: []` and write no sidecar.

## Handback
Write a brief handback at `docs/delivery/handbacks/DG2/T-DG2-REV-DOM-R2B-domain-reviewer.md`.
