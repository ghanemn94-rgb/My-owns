# DG5 gate review: qa-verifier (round 2)

Task ID: `T-DG5-REV-QA-R2`. You are the independent qa verifier of the frozen **DG5** candidate (P5 "Configuration automation and outputs"). You did not implement any DG5 requirement and are read-only to the implementation.

## Candidate

- **candidate_id:** `sha256:c4f70a80196e79c75883e970656a84fa8a365d9f9f5091d14ad144be2361f06e`. Verify it with `node tools/gates/candidate.mjs --stage DG5` (2183 files) on a **complete clone**. If the clone is incomplete, the review is BLOCKED.
- **manifest:** `docs/delivery/candidates/DG5/c4f70a80196e79c7.manifest.json`.
- **source_commit:** `d3528fc`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin`.
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Ports:** use ports below 32768; the harnesses retry on collision. **Your ranges are 26600–26699.** The other two reviewers run at the same time on other ranges.
- **Previous gates:** DG4, DG3, DG2 and DG1 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG4` must pass, and so must `--historical --stage DG3`, `DG2` and `DG1`.
- **Design and delivery context:**
  - `docs/architecture/p5-plan.md` and `docs/architecture/p5-work-split.md`;
  - `docs/architecture/adr/ADR-0039` … `ADR-0050`, with their dated amendments (T-DG5-ARCH-R1, R2, R3), which win where they differ from the original text; the DG1–DG4 ADRs they extend;
  - `docs/delivery/decisions.md` D-141 to D-171 (the repair waves and their decisions: D-155 to D-171; round 1 and its repairs: D-170, D-171);
  - the P5 implementer handbacks in `docs/delivery/handbacks/DG5/`;
  - the QA authoring handbacks in `docs/delivery/test-evidence/DG5/qa/T-DG5-QA-{A,C,D,B,E,F,E2,F2}-authoring/`;
  - the orchestrator's merged-tree verifications in `docs/delivery/test-evidence/DG5/orchestrator-D-*/` and the merged-tree verification named in D-171 (`orchestrator-D-171/`).
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, for the 78 rows with `final_gate` = DG5). Test them literally. The DG5 rows are IMPLEMENTED with evidence (`validate.mjs --register DG5` PASS). Their `notes` disclose every clause covered only partly; judge whether each such disclosure is acceptable.
- **Product gates G1–G6 are business approvals inside the product.** They never imply or relate to the engineering gates DG0–DG7. Product G6 never implies DG7.
- **The confined sandbox** gives you a read-only `node_modules`. Vitest's config loader then needs `--configLoader runner`; the A06 and A07 root specs need `E2E_SCREENSHOT_DIR` pointed at a writable path. Use them, and say so. Run anything that builds or writes in a disposable clone under `$TMPDIR`.
- **The demo database:** `e2e/support/with-demo-stack.sh` starts a demo-initialized stack (`AUTH_MODE=dev`), where the demo role users `roaming.user.*` sign in through the dev sign-in (D-165). The production-initialized stack is `apps/web/e2e/support/with-stack.sh`.
- **Machine load.** The three reviews run at the same time, so the load is high. A long e2e journey can cross its 30 s limit under load. If a test times out, re-run that spec alone and report both runs. Never treat a timeout as a pass, and never hide one.

## Round 2: what changed since round 1, and what to judge

- **Round 1** ran on candidate `sha256:8e7d23a3…`, source `601d7d2`. It raised six findings: F-DG5-100 and 101 (code-security), F-DG5-120 and 121 (domain), and F-DG5-140 and 141 (qa).
  - D-170 decided their repairs.
  - Repair wave V1 delivered them, and D-171 records the integration and the merged-tree verification.
  - The round-1 records, findings and evidence are in `docs/delivery/reviews/DG5/round-1/` and `docs/delivery/test-evidence/DG5/{domain,code-security,qa}/round-1/`.
- **Observations (a) to (g) in D-171 are open for you to judge.** Implementers raised them outside D-170's decided scope:
  - (a) and (b): BE-V1's other approval paths;
  - (c): BE-V2C's launch `subjectRecordId`;
  - (d), (e) and (f): FE-V1B's wording and the remaining DG2–DG4 table wraps;
  - (g): BE-V3's G4 exceptions and the events the seed does not emit.
  For each observation in your focus, either accept it with a reason in a check's `actual`, or raise a finding.
- **The orchestrator's a02 fixture hunk** (`6c7f54b`) changes a qa-authored test. The qa reviewer judges it first, but any reviewer may.


## Verify your round-1 findings on THIS candidate, adversarially

- **F-DG5-140 (Medium; REQ-PB-093):** `/admin/studio/scoring-defaults` did not reflow (page-level horizontal scroll at 390 px and with 200 % text).
  - **Claimed fix (T-DG5-FE-V1):** the shared `fieldset { min-inline-size: 0 }` rule, and wide rubric tables that scroll inside named, focusable regions.
  - **To verify:** re-run your reflow probe unchanged, on all 31 P5 screens, at 390 px and with 200 % text, in en and ar, in both locale settings.
- **F-DG5-141 (Medium; REQ-S02-001):** the source-coverage table's scroll region was not keyboard-focusable (axe 'scrollable-region-focusable', serious).
  - **Claimed fix (T-DG5-FE-V1):** every shared table wrapper is a focusable, named region (`tabIndex=0`, `role="region"`, a localized name).
  - **To verify:**
    - re-run your axe probe at 390 px, 1366 px and with 200 % text, in en and ar;
    - check that keyboard focus reaches the region and that it scrolls;
    - check the new `apps/web/e2e/p5-reflow-axe.spec.ts` asserts what it claims.
- **Also judge, for QA:**
  - the orchestrator's a02 fixture hunk (`6c7f54b`) in `tests/qa/integration/a02-a21-complete-lifecycle.test.ts`. It staffs the intake's organization Lead on T because F-DG5-101's fix now refuses an unreadable output. Does the test still assert its row's clause?
  - the new tests of the repairs (`studio-coauthor-review`, `rule-coauthor-review`, `output-read-authorization`, `evidence-link-read-authorization`, `demo-gate-history`, `readiness-covered`, `table-regions`, `p5-reflow-axe`): do they assert what their findings require?

**The verifications file.** Write `docs/delivery/reviews/DG5/round-2/qa-verifier.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`.
- If the fix is genuine: `result: "PASS"`, `status_after: "CLOSED_VERIFIED"`.
- Otherwise: `result: "FAIL"`, with the reason and the reproduction.

A residual you judge not worth a finding goes in the note, with your reasoning. **Your verdict can be PASS only if each of your round-1 findings verifies CLOSED.**

**The repair diff** is `git diff 601d7d2..d3528fc`, from round 1's source `601d7d2` to this candidate's source. The repairs are:
- T-DG5-BE-V1, with migration `0097`;
- T-DG5-BE-V2, BE-V2B and BE-V2C;
- T-DG5-BE-V3;
- T-DG5-FE-V1 and FE-V1B;
- T-DG5-ARCH-R4, documentation and OpenAPI description text only;
- the orchestrator's a02 fixture hunk, `6c7f54b`.

Their handbacks are in `docs/delivery/handbacks/DG5/`. D-170 decided each repair; D-171 records the integration, the verification and the observations disclosed for you to judge.

- **Re-inspect the whole repair diff for regressions.** A repair must not weaken any other behaviour.
- **Then run your full review,** as below. This round is a complete review of the new candidate, not only a check of the repairs.

**New finding ids.** Your round-1 ids are taken. Continue your range in order, after the last id you used.

## Your focus: derive checks from the acceptance criteria of all 78 DG5-final requirements

Run positive, negative, regression, bilingual and reliability checks, and test every `acceptance` text **literally**.
- **Tests you may write:** under `docs/delivery/test-evidence/DG5/qa/tests/round-2/`, never in the candidate tree (the candidate is frozen). Never touch product code.
- **Evidence:** under `docs/delivery/test-evidence/DG5/qa/round-2/`.
- **The executable acceptance suites in the candidate.** `tests/qa/**` and `e2e/**` hold A02, A06, A07, A13, A15, A16, A21 and A22, plus the DG2–DG4 suites. Each QA authoring handback has a requirement → test table. The authoring tasks were not the gate review; you are.
  - Re-run the suites.
  - Read each test, and check that it asserts its row's clause.
  - Probe beyond them wherever a clause is untested or only partly tested; the register `notes` say where.

### Execute, with real output

A missing tool or database is BLOCKED.

1. **Static:** `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm format:check`, and `pnpm --filter @mth/design-tokens run check:contrast`.
2. **Unit:** `pnpm test` on Node 22 and Node 24, in both locale settings.
3. **Integration:** run it on a disposable PostgreSQL, **twice**. It covers migrations `0001`→`0097` and `contract/contract.test.ts` (846 operations; every `p5-pending-*.ts` list empty). Then run `tests/qa` on its own.
4. **e2e:**
   - run the product journeys (`apps/web/e2e`) and the root acceptance specs (`e2e/`, by explicit paths: `a03`, `a04`, `a06`, `a07`, `a08-a09`, `a13`, `a15`, `a16`, `a20` and `a22` on `with-stack.sh`; `a02-*` and `a21` on `e2e/support/with-demo-stack.sh`) on the real stack, `--workers=1`;
   - in **chromium-en and chromium-ar**, in both locale settings;
   - axe must report no serious or critical issues;
   - include an AUD read-only pass;
   - check 390 px and 200 % text on the P5 screens.
5. **REQ-DLV-037:** the A06, A07, A15 and A16 executable tests pass on **this frozen candidate**. Record the counts per suite. Inspect exported PDF, DOCX, XLSX and PPTX samples in both languages.
6. **Register and pipeline:**
   - `node tools/gates/validate.mjs --register DG5`;
   - `--pipeline`;
   - `--historical --stage DG4`.

## Requirements to check (record EXACTLY these, 78)

`REQ-PB-001`, `REQ-PB-002`, `REQ-PB-011`, `REQ-PB-077`, `REQ-PB-086`, `REQ-PB-087`, `REQ-PB-088`, `REQ-PB-089`, `REQ-PB-090`, `REQ-PB-091`, `REQ-PB-092`, `REQ-PB-093`, `REQ-DLV-037`, `REQ-S01-002`, `REQ-S01-003`, `REQ-S01-004`, `REQ-S02-001`, `REQ-S02-004`, `REQ-S03-007`, `REQ-S03-010`, `REQ-S04-011`, `REQ-S05-001`, `REQ-S05-002`, `REQ-S05-006`, `REQ-S06-001`, `REQ-S06-002`, `REQ-S06-003`, `REQ-S06-004`, `REQ-S06-005`, `REQ-S06-006`, `REQ-S06-007`, `REQ-S06-008`, `REQ-S06-009`, `REQ-S06-010`, `REQ-S07-016`, `REQ-S08-005`, `REQ-S08-019`, `REQ-S09-011`, `REQ-S10-013`, `REQ-S10-015`, `REQ-S12-001`, `REQ-S12-002`, `REQ-S12-003`, `REQ-S12-004`, `REQ-S12-012`, `REQ-S12-015`, `REQ-S12-018`, `REQ-S12-020`, `REQ-S12-021`, `REQ-S12-022`, `REQ-S12-025`, `REQ-S12-026`, `REQ-S13-004`, `REQ-S13-005`, `REQ-S13-006`, `REQ-S13-007`, `REQ-S13-008`, `REQ-S13-009`, `REQ-S13-010`, `REQ-S14-001`, `REQ-S14-002`, `REQ-S14-003`, `REQ-S14-004`, `REQ-S15-004`, `REQ-S16-010`, `REQ-S16-012`, `REQ-S16-015`, `REQ-S16-021`, `REQ-S18-001`, `REQ-S18-002`, `REQ-S18-003`, `REQ-S18-004`, `REQ-S20-002`, `REQ-S20-006`, `REQ-S20-007`, `REQ-S20-015`, `REQ-S20-016`, `REQ-S21-001`.

## Evidence honesty (DG2 round-10 audit condition 1, binding)

- In your record, report every non-zero exit, failed suite, hook timeout, skipped or flaky test, or error line that appears in any log you cite. Explain each one, whatever its cause, in the check's `actual`.
- A check whose evidence holds an unexplained failure cannot be PASS.
- A probe that exits non-zero "by design" must say exactly which assertions failed and why.

## Environmental residuals: NOT BLOCKED gate checks

Record each of these as PASS on the offline/config surface, and note the residual. A BLOCKED check fails the gate round.
- Live registry: REQ-DLV-042 AC-1, D-057.
- Live CI: REQ-DLV-025 A24, D-058.
- Keycloak and a real demo IdP: D-049; the demo deployment's IdP is a devops item (ADR-0050 §1); the dev-mode binding of D-165 is the test path.
- AI and external notification adapters: none ships in P5 (D-142 Q11); A21's "disabled" is the shipped configuration (D-165).

## Record format (MANDATORY)

Write `docs/delivery/reviews/DG5/round-2/qa-verifier.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG5/round-2/qa-verifier.md` (bare path);
- `candidate_id` as above;
- `reviewer_role: qa-verifier`, `round: 2`, `stage_id: DG5`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids listed above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if all four hold:
  - every requirement you check is verifiable with evidence;
  - every failure in the logs you cite is disclosed and explained;
  - nothing Critical, High or mandatory is unresolved;
  - you raised no finding you consider blocking.

Mirror the field set of `docs/delivery/reviews/DG4/round-10/qa-verifier.json`.

## Finding record format: STRICT (use YOUR id range only)

- **Your id range for any NEW finding:** **F-DG5-142 to F-DG5-159** (F-DG5-140 and F-DG5-141 are taken by round 1), used in order. Never use another id. The other reviewers have their own ranges.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG5/round-2/qa-verifier.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG5");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("qa-verifier");
  - `reported_in` ("docs/delivery/reviews/DG5/round-2/qa-verifier.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
