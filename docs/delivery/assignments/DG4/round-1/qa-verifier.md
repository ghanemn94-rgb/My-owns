# DG4 gate review: qa-verifier (round 1)

Task ID: `T-DG4-REV-QA-R1`. You are the independent QA verifier of the frozen **DG4** candidate (P4 "Execution value and sustainment"). You may author tests under `docs/delivery/test-evidence/DG4/qa/tests/round-1/`, never product code.

## Candidate

- **candidate_id:** `sha256:19656b1ff2cc5ce167e8651166631c105d74883e45e1d714e8cff0d087eae86e`. Verify it with `node tools/gates/candidate.mjs --stage DG4` (1449 files) on a **complete clone**. If the clone is incomplete, the review is BLOCKED.
- **manifest:** `docs/delivery/candidates/DG4/19656b1ff2cc5ce1.manifest.json`.
- **source_commit:** `a91d82c`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Ports:** use ports below 32768; the harnesses retry on collision. **Your ranges are 26500–26699.** The other two reviewers run at the same time on other ranges.
- **Previous gates:** DG3, DG2 and DG1 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG3` must pass, and so must `--historical --stage DG2` and `--historical --stage DG1`.
- **Design and delivery context:**
  - `docs/architecture/p4-plan.md`;
  - `docs/architecture/p4-work-split.md`;
  - `docs/architecture/adr/ADR-0025` … `ADR-0038`, with their dated amendments, which win where they differ from the original text;
  - `docs/delivery/decisions.md` D-088 to D-116;
  - the P4 implementer handbacks in `docs/delivery/handbacks/DG4/`;
  - the QA authoring handbacks in `docs/delivery/test-evidence/DG4/qa/T-DG4-QA-{A,B,C,D}-authoring/`.
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, for the 137 rows with `final_gate` = DG4). Test them literally. The DG4 rows are IMPLEMENTED with evidence (`validate.mjs --register DG4` PASS). Their `notes` disclose every clause that is covered only partly; judge whether each such disclosure is acceptable.
- **Product gates G1–G6 are business approvals inside the product.** They never imply or relate to the engineering gates DG0–DG7. Product G6 never implies DG7.
- **The confined sandbox** gives you a read-only `node_modules`. Vitest's config loader then needs `--configLoader runner` (QA-A's finding). Use it, and say so. Run anything that builds or writes in a disposable clone under `$TMPDIR`.
- **Machine load.** The three reviews run at the same time, so the load is high. A long e2e journey can cross its 30 s limit under load; D-111, D-112 and D-115 record this. If a test times out, re-run that spec alone and report both runs. Never treat a timeout as a pass, and never hide one.

## Your focus: derive checks from the acceptance criteria of all 137 DG4-final requirements

Run positive, negative, regression, bilingual and reliability checks, and test every `acceptance` text **literally**.
- **Tests you may write:** under `docs/delivery/test-evidence/DG4/qa/tests/round-1/`, never in the candidate tree (agent-protocol: the candidate is frozen). Never touch product code.
- **Evidence:** put it under `docs/delivery/test-evidence/DG4/qa/round-1/`.
- **The executable acceptance suites in the candidate.** `tests/qa/**` and `e2e/**` hold A03, A04, A05, A08, A09, A10, A11, A12, A13 and A14, plus QA-D's two tests. Each QA authoring handback has a requirement → test table.
  - Re-run the suites.
  - Read each test, and check that it asserts its row's clause.
  - Probe beyond them wherever a clause is untested or only partly tested; the register `notes` say where.

### Execute, with real output

A missing tool or database is BLOCKED.

1. **Static:** `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm format:check`, and `pnpm --filter @mth/design-tokens run check:contrast`.
2. **Unit:** `pnpm test` on Node 22 and Node 24, in both locale settings.
3. **Integration:** run it on a disposable PostgreSQL, **twice**. It covers migrations `0001`→`0060` and `contract.test.ts` (652 operations; every `p4-pending-*.ts` list empty). Then run `tests/qa` on its own.
4. **e2e:**
   - run the product journeys (`apps/web/e2e`) and the acceptance specs (`e2e/`) on the real stack, `--workers=1`;
   - in **chromium-en and chromium-ar**, in both locale settings;
   - axe must report no serious or critical issues;
   - include an AUD read-only pass;
   - check 390 px and 200 % text on the P4 screens.
5. **REQ-DLV-036:** the A04, A09, A10 and A11 executable tests pass on **this frozen candidate**. Record the counts per suite.
6. **Register and pipeline:**
   - `node tools/gates/validate.mjs --register DG4`;
   - `--pipeline`;
   - `--historical --stage DG3`.

## Requirements to check (record EXACTLY these, 137)

`REQ-PB-005`, `REQ-PB-008`, `REQ-PB-009`, `REQ-PB-010`, `REQ-PB-013`, `REQ-PB-014`, `REQ-PB-015`, `REQ-PB-020`, `REQ-PB-021`, `REQ-PB-044`, `REQ-PB-058`, `REQ-PB-060`, `REQ-PB-061`, `REQ-PB-062`, `REQ-PB-063`, `REQ-PB-064`, `REQ-PB-065`, `REQ-PB-066`, `REQ-PB-067`, `REQ-PB-068`, `REQ-PB-069`, `REQ-PB-070`, `REQ-PB-071`, `REQ-PB-072`, `REQ-PB-073`, `REQ-PB-074`, `REQ-PB-075`, `REQ-PB-076`, `REQ-PB-078`, `REQ-PB-079`, `REQ-PB-080`, `REQ-PB-081`, `REQ-PB-082`, `REQ-PB-083`, `REQ-PB-084`, `REQ-PB-085`, `REQ-DLV-036`, `REQ-S03-001`, `REQ-S03-002`, `REQ-S03-003`, `REQ-S03-004`, `REQ-S03-005`, `REQ-S03-006`, `REQ-S03-008`, `REQ-S03-009`, `REQ-S03-011`, `REQ-S04-001`, `REQ-S04-002`, `REQ-S04-007`, `REQ-S04-008`, `REQ-S04-009`, `REQ-S04-010`, `REQ-S04-012`, `REQ-S04-013`, `REQ-S04-014`, `REQ-S07-001`, `REQ-S07-002`, `REQ-S07-003`, `REQ-S07-004`, `REQ-S07-005`, `REQ-S07-006`, `REQ-S07-007`, `REQ-S07-008`, `REQ-S07-009`, `REQ-S07-010`, `REQ-S07-011`, `REQ-S07-012`, `REQ-S07-013`, `REQ-S07-014`, `REQ-S07-015`, `REQ-S07-017`, `REQ-S08-001`, `REQ-S08-002`, `REQ-S08-003`, `REQ-S08-004`, `REQ-S08-006`, `REQ-S08-008`, `REQ-S08-009`, `REQ-S08-010`, `REQ-S08-011`, `REQ-S08-013`, `REQ-S08-014`, `REQ-S08-015`, `REQ-S08-016`, `REQ-S08-017`, `REQ-S08-018`, `REQ-S09-007`, `REQ-S09-009`, `REQ-S09-010`, `REQ-S10-003`, `REQ-S10-005`, `REQ-S10-006`, `REQ-S10-007`, `REQ-S10-008`, `REQ-S10-009`, `REQ-S10-010`, `REQ-S10-011`, `REQ-S10-012`, `REQ-S10-014`, `REQ-S10-016`, `REQ-S10-017`, `REQ-S10-018`, `REQ-S10-019`, `REQ-S11-001`, `REQ-S11-002`, `REQ-S11-004`, `REQ-S11-005`, `REQ-S11-006`, `REQ-S11-007`, `REQ-S11-008`, `REQ-S11-009`, `REQ-S12-005`, `REQ-S12-006`, `REQ-S12-009`, `REQ-S12-010`, `REQ-S12-011`, `REQ-S12-014`, `REQ-S12-016`, `REQ-S13-001`, `REQ-S13-002`, `REQ-S13-003`, `REQ-S15-008`, `REQ-S16-005`, `REQ-S16-011`, `REQ-S16-014`, `REQ-S16-017`, `REQ-S16-018`, `REQ-S16-019`, `REQ-S16-020`, `REQ-S16-025`, `REQ-S20-003`, `REQ-S20-004`, `REQ-S20-005`, `REQ-S20-008`, `REQ-S20-009`, `REQ-S20-010`, `REQ-S20-011`.

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

Write `docs/delivery/reviews/DG4/round-1/qa-verifier.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG4/round-1/qa-verifier.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: qa-verifier`, `round: 1`, `stage_id: DG4`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids listed above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if all four hold:
  - every requirement you check is verifiable with evidence;
  - every failure in the logs you cite is disclosed and explained;
  - nothing Critical, High or mandatory is unresolved;
  - you raised no finding you consider blocking.

Mirror the field set of `docs/delivery/reviews/DG3/round-7/qa-verifier.json`.

## Finding record format: STRICT (use YOUR id range only)

- **Your id range for any NEW finding:** **F-DG4-140 to F-DG4-159**, used in order. Never use another id. The other reviewers have their own ranges.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG4/round-1/qa-verifier.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG4");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("qa-verifier");
  - `reported_in` ("docs/delivery/reviews/DG4/round-1/qa-verifier.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
