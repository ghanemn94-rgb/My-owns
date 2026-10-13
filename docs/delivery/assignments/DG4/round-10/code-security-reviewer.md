# DG4 gate review: code-security-reviewer (round 10)

Task ID: `T-DG4-REV-SEC-R10`. You are the independent code and security reviewer of the frozen **DG4** candidate (P4 "Execution value and sustainment"). You did not implement any DG4 requirement and are read-only to the implementation.

## Candidate

- **candidate_id:** `sha256:f38274cb6d50c49857a89876cec1bc4713f69ef84b29a6f5b9af10061317ccc6`. Verify it with `node tools/gates/candidate.mjs --stage DG4` (1475 files) on a **complete clone**. If the clone is incomplete, the review is BLOCKED.
- **manifest:** `docs/delivery/candidates/DG4/f38274cb6d50c498.manifest.json`.
- **source_commit:** `e70ac02`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Ports:** use ports below 32768; the harnesses retry on collision. **Your ranges are 26300–26399.** The other two reviewers run at the same time on other ranges.
- **Previous gates:** DG3, DG2 and DG1 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG3` must pass, and so must `--historical --stage DG2` and `--historical --stage DG1`.
- **Design and delivery context:**
  - `docs/architecture/p4-plan.md`;
  - `docs/architecture/p4-work-split.md`;
  - `docs/architecture/adr/ADR-0025` … `ADR-0038`, with their dated amendments, which win where they differ from the original text;
  - `docs/delivery/decisions.md` D-088 to D-139;
  - the P4 implementer handbacks in `docs/delivery/handbacks/DG4/`;
  - the QA authoring handbacks in `docs/delivery/test-evidence/DG4/qa/T-DG4-QA-{A,B,C,D}-authoring/`.
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, for the 137 rows with `final_gate` = DG4). Test them literally. The DG4 rows are IMPLEMENTED with evidence (`validate.mjs --register DG4` PASS). Their `notes` disclose every clause that is covered only partly; judge whether each such disclosure is acceptable.
- **Product gates G1–G6 are business approvals inside the product.** They never imply or relate to the engineering gates DG0–DG7. Product G6 never implies DG7.
- **The confined sandbox** gives you a read-only `node_modules`. Vitest's config loader then needs `--configLoader runner` (QA-A's finding). Use it, and say so. Run anything that builds or writes in a disposable clone under `$TMPDIR`.
- **Machine load.** The three reviews run at the same time, so the load is high. A long e2e journey can cross its 30 s limit under load; D-111, D-112 and D-115 record this. If a test times out, re-run that spec alone and report both runs. Never treat a timeout as a pass, and never hide one.

## This round's scope: review of the round-9 repairs (D-137 to D-139; it overrides 'full review' wherever this assignment says so)

- **What changed.** `git diff f2ae7170630456a772e1ceac90ab6d96b68e3f5c..e70ac02f63cd1f42487cfa4dae73f68e933da015 -- . ':!docs/delivery'` lists exactly nine files:
  - **T-DG4-FE-R11** (F-DG4-160, raised by the round-9 release-auditor, and a sweep of similar strings):
    - `apps/web/src/i18n/{en,ar}/transformations.json` (`form.statusHint`);
    - `apps/web/src/i18n/{en,ar}/nav.json` (`plannedBody`, `willContain`, `entry.portfolioPlanned`);
    - the tests that pin them: `apps/web/src/app/app.test.tsx`, `apps/web/src/pages/transformations/transformations.test.tsx`, `apps/web/e2e/journeys.spec.ts`, `apps/web/e2e/p3-seams.spec.ts`.
  - **T-DG4-BE-R7** (a test-reliability defect found before the freeze): `tests/qa/integration/a08-gate-controls.test.ts` (`deliveryFingerprint` narrowed to `DELIVERY_RECORDS`, as in `g5-g6.test.ts`).
- **Everything else is byte-identical** to round 9's candidate `18c18fe4`, which you reviewed (your round-9 record), and to round 7's, which you reviewed in full.
- **Read:** D-137, D-138 and D-139; the round-9 audit record (`docs/delivery/reviews/DG4/round-9/release-auditor.json`, `release-auditor.findings.json`); the handbacks `docs/delivery/handbacks/DG4/T-DG4-FE-R11-frontend-ux-engineer.md` (with its sweep table, §3) and `T-DG4-BE-R7-backend-workflow-engineer.md`, and their evidence.
- **Required this round:**
  1. verify the candidate identity on a complete clone;
  2. show that the product diff from `f2ae717` is exactly those nine files;
  3. review that diff for your role (below);
  4. judge D-137, D-138 and D-139 against the evidence;
  5. run the validators (`--historical --stage DG3`, `DG2`, `DG1`, `--register DG4`, `--pipeline`) and the static checks (typecheck, lint, format, openapi:lint, no-cdn).
- **Carry-forward:** for every other check of your role, cite your round-7 to round-9 evidence on identical code. Say plainly in each check's `actual` that it was not re-run and why. Never report a check you did not run as run this round.
- **The load envelope** (`environment.md` limitation 6): only qa runs `pnpm test`, the full integration suite or e2e this round. Domain and code-security may run single test files.
- **Findings to verify:** none of yours. F-DG4-160 is verified by its reporter, the release-auditor, in the audit. You write no verifications file this round. The 23 round-9 re-verifications and F-DG4-148's acceptance stand.

### Your review of the diff

- Read all nine files' diffs line by line. Confirm the web changes are catalogue text and tests only: no logic, routing or authorization change, no key removed that something still reads (`pnpm -r typecheck` and a grep of each changed key's readers).
- **BE-R7.** Confirm `deliveryFingerprint` keeps a sound assertion: the covered set, the missing-path rule, the before/after equality, and the non-vacuity evidence (`T-DG4-BE-R7-evidence/04-non-vacuity*.log`). Re-run that test file once (`tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/a08-gate-controls.test.ts`) and report the G6 test's duration.
- Confirm no other test reads `docs/delivery/` wholesale in a way that grows with every round (grep), or name it.

**Your verdict:** PASS only if your review of the diff and your confirmation checks pass and you raise nothing blocking.

## Your focus: correctness, architecture, authorization, data integrity, concurrency, injection and security

Inspect the P4 diff directly: `git diff d3e6fe6..e70ac02`, covering product code (`apps/**`, `packages/**`) and migrations `0028`–`0060`. Back every finding with a file and line reference, and a reproduction. Cover at least the following.

### Authorization and separation of duties

- **Every P4 mutation needs all five of these:**
  - server-side authorization **re-checked at commit time**;
  - validation;
  - `If-Match` (409/428), including the version-0 `ETag: "0"` reads of D-109;
  - one audit event;
  - no client or remote I/O inside a transaction.
- **AUD and ADM-only callers.** AUD gets 403 on every P4 write, and an ADM-only caller sees nothing transformation-scoped. Run the sweep.
- **Business approvals** (ADR-0026). It must be impossible to self-approve, to approve as a non-approver, to approve a stale version (409), or to resubmit or withdraw as a non-requester (`approval.not_requester`). Check delegation and its loop guard, and the escalation timer.
- **Finance validation.** Only Finance validates, and a validated value can never be edited in place.
- **Handovers.** Only the receiving owner accepts.
- **Scope.** The dashboard, drill-down, My Work, traceability and orphan reads must never disclose another transformation's records (ADR-0037 §6); an unreadable id is 404. Note the two known outsider-status differences: dispensation writes answer 403, reporting/modular writes answer 404 (D-111, D-112).

### Data integrity, jobs and concurrency

- **Exactly once.**
  - **Scope:** calculation runs, Finance queue items, corrective cases, escalations, interventions, reviews, checks and closures.
  - **Proof:** the advisory-lock registry (730224–730249), the unique backstops, `runOnce`, and replay of the same event.
  - **The worker:** it imports no API code, and the parity tests hold (D-102).
- **Decimals.** Money, rates, shares and allocations are decimal end to end, with no float.
- **Formula lineage.** It is stored, and `sources` are found by name (ADR-0027 C1, C4–C5).
- **Migrations `0028`–`0060`.** They are forward-only and contiguous. Each has row guards, version steps, audit coverage and append-only history.
- **The `Problem.params` addition** (D-114). Check that it is additive and that every other problem response is unchanged.

### Contract and seams

- **The contract.** `docs/api/openapi.yaml` has 652 operations. Every `p4-pending-*.ts` list is empty. Check `config.consumes` and the media-type pin.
- **The module graph.** It is acyclic, `governance` → `raid` included, and `raid` never imports `governance` (ADR-0032 G1).
- **Production wiring.** It goes through `server.ts` (D-107).
- **The web.** Session-bound actions only; lazy routes (D-115); no import cycle.

### Run these, with real output

A missing tool or database is BLOCKED.
- `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm format:check`;
- `pnpm test` on Node 22 **and** Node 24;
- the integration suite on a disposable PostgreSQL, **twice**: once with `LANG`/`LC_ALL` unset and once with `LANG=C.UTF-8`. It includes `contract.test.ts` and migrations `0001`→`0060`;
- `node tools/gates/validate.mjs --historical --stage DG3`.

Put your evidence under `docs/delivery/test-evidence/DG4/code-security/round-10/`.

## Requirements to check (record EXACTLY these, 52)

`REQ-PB-013`, `REQ-PB-015`, `REQ-PB-082`, `REQ-PB-083`, `REQ-PB-085`, `REQ-S03-001`, `REQ-S03-008`, `REQ-S04-002`, `REQ-S04-009`, `REQ-S04-010`, `REQ-S04-014`, `REQ-S07-003`, `REQ-S07-009`, `REQ-S07-013`, `REQ-S07-015`, `REQ-S08-004`, `REQ-S08-006`, `REQ-S08-015`, `REQ-S08-017`, `REQ-S09-010`, `REQ-S10-003`, `REQ-S10-005`, `REQ-S10-006`, `REQ-S10-007`, `REQ-S10-008`, `REQ-S10-009`, `REQ-S10-010`, `REQ-S10-011`, `REQ-S10-012`, `REQ-S10-014`, `REQ-S10-016`, `REQ-S10-017`, `REQ-S10-018`, `REQ-S10-019`, `REQ-S11-005`, `REQ-S11-009`, `REQ-S12-005`, `REQ-S12-006`, `REQ-S12-009`, `REQ-S12-010`, `REQ-S12-011`, `REQ-S12-014`, `REQ-S12-016`, `REQ-S13-001`, `REQ-S16-005`, `REQ-S16-011`, `REQ-S16-014`, `REQ-S16-017`, `REQ-S16-018`, `REQ-S16-019`, `REQ-S16-020`, `REQ-S16-025`.

## Evidence honesty (DG2 round-10 audit condition 1, binding)

- In your record, report every non-zero exit, failed suite, hook timeout, skipped or flaky test, or error line that appears in any log you cite. Explain each one, whatever its cause, in the check's `actual`.
- A check whose evidence holds an unexplained failure cannot be PASS.
- A probe that exits non-zero "by design" must say exactly which assertions failed and why.

## Environmental residuals: NOT BLOCKED gate checks

Record each of these as PASS on the offline/config surface, and note the residual. A BLOCKED check fails the gate round.
- Live registry: REQ-DLV-042 AC-1, D-057.
- Live CI: REQ-DLV-025 A24, D-058.
- Keycloak: D-049.

## Record format (MANDATORY)

Write `docs/delivery/reviews/DG4/round-10/code-security-reviewer.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG4/round-10/code-security-reviewer.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: code-security-reviewer`, `round: 10`, `stage_id: DG4`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids listed above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if all four hold:
  - every requirement you check is verifiable with evidence;
  - every failure in the logs you cite is disclosed and explained;
  - nothing Critical, High or mandatory is unresolved;
  - you raised no finding you consider blocking.

Mirror the field set of `docs/delivery/reviews/DG3/round-7/code-security-reviewer.json`.

## Finding record format: STRICT (use YOUR id range only)

- **Your id range for any NEW finding:** **F-DG4-107 to F-DG4-119**, used in order. Never use another id. The other reviewers have their own ranges.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG4/round-10/code-security-reviewer.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG4");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("code-security-reviewer");
  - `reported_in` ("docs/delivery/reviews/DG4/round-10/code-security-reviewer.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
