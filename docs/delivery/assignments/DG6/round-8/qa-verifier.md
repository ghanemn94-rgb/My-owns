# DG6 gate review: qa-verifier (round 8)

Task ID: `T-DG6-REV-QA-R8`. You are the independent qa verifier of the frozen **DG6** candidate (P6 "Integration and system hardening"). You did not implement any DG6 requirement and are read-only to the implementation.

## Candidate

- **candidate_id:** `sha256:6cda8b33e184b41983d7718cf6ad15d3912337219fd5c15d9b9d516f0142f21d`. Verify it with `node tools/gates/candidate.mjs --stage DG6` (2754 files) on a **complete clone**. If the clone is incomplete, the review is BLOCKED.
- **manifest:** `docs/delivery/candidates/DG6/6cda8b33e184b419.manifest.json`.
- **source_commit:** `d84d11a62f52932dd5c0aa932c5c1790c13e7e8b` (record this full 40-character id in your record's `source_commit`).
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; 22.22.2 at `/opt/node22/bin` if present (if it is absent, say so: the Node 22 run is then BLOCKED, not PASS).
- **Browser:** pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Ports:** use ports below 32768; the harnesses retry on collision. **Your range is 30700–30799.** The other two reviewers run at the same time on other ranges.
- **Previous gates:** DG0 to DG5 are APPROVED. `node tools/gates/validate.mjs --historical --stage DG5` must pass, and so must `--historical --stage DG4`, `DG3`, `DG2` and `DG1`.
- **Design and delivery context:**
  - `docs/architecture/p6-plan.md` and `docs/architecture/p6-work-split.md`;
  - `docs/architecture/adr/ADR-0051` … `ADR-0059` and `ADR-0061` (there is no ADR-0060), with their dated amendments, which win where they differ from the original text; `ADR-0043` as amended by T-DG6-ARCH-07 to ARCH-10 (worker batching, the `automation_rule_enablement` ledger of migrations `0122`/`0123`, D-204 and D-205); the DG1–DG5 ADRs they extend;
  - `docs/delivery/decisions.md` D-193 to D-225 (DG6 start and plan: D-194 to D-196; the build waves: D-197 to D-202; round 1 and its repairs: D-206 to D-208; round 2 and its repairs: D-209 and D-210; round 3 and its repairs: D-211; round 4 and its repairs: D-212 to D-214; round 5 and its repairs: D-215, D-216; round 6 and its repairs: D-217 to D-220; round 7 and its repairs: D-221 to D-225; the pre-freeze repairs: D-203 to D-205);
  - the P6 implementer and architect handbacks in `docs/delivery/handbacks/DG6/`;
  - the QA authoring handbacks in `docs/delivery/test-evidence/DG6/qa/T-DG6-QA-*-authoring/`;
  - the orchestrator's merged-tree verifications in `docs/delivery/test-evidence/DG6/orchestrator-*/`. The final one is `orchestrator-final-dbcb469/` (read its `README.md`): a full run on `dbcb46995` in which every step exits 0. The candidate's product tree equals `dbcb46995`'s.
- **The binding acceptance texts** are in `docs/delivery/requirements.csv` (`acceptance`, for the 48 rows with `final_gate` = DG6). Test them literally. The DG6 rows are IMPLEMENTED with evidence (`validate.mjs --register DG6` PASS). Their `notes` disclose every clause covered only partly, and several say "the binding re-run is the orchestrator's freeze verification" (REQ-S12-019, REQ-S15-014, REQ-S17-007, among others). Judge whether each such disclosure is acceptable, and re-run what it defers rather than trusting it.
- **Product gates G1–G6 are business approvals inside the product.** They never imply or relate to the engineering gates DG0–DG7. Product G6 never implies DG7.
- **The confined sandbox** gives you a read-only `node_modules`. Vitest's config loader then needs `--configLoader runner`; the A06 and A07 root specs need `E2E_SCREENSHOT_DIR` pointed at a writable path. Use them, and say so. Run anything that builds or writes in a disposable clone under `$TMPDIR`.
- **The stacks.** `apps/web/e2e/support/with-stack.sh` starts the production-initialized stack (it runs **no worker**; specs that need one start it themselves). `e2e/support/with-demo-stack.sh` starts a demo-initialized stack (`AUTH_MODE=dev`), where the demo role users `roaming.user.*` sign in through the dev sign-in (D-165).
- **Test-only settings.** The A17 webhook suites need `MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001`. It is a synthetic test value, not a secret (renamed by T-DG6-BE-Y2 for the `MTH_SECRET_*` SecretRef namespace, F-DG6-120). The worker's batch and concurrency are `WORKER_JOB_BATCH_SIZE` / `WORKER_JOB_CONCURRENCY` (defaults 8 and 4, D-203).
- **Machine load.** The three reviews run at the same time, so the load is high. A long e2e journey can cross its time limit under load. If a test times out, re-run that spec alone and report both runs. Never treat a timeout as a pass, and never hide one.

## What this round is

This is DG6's eighth gate round. Round 7 on candidate `b64b95ff` (source `70f05ed49d893378efc99cd3e1a4027fc77697e8`) failed one review (D-221): code-security raised F-DG6-480 (Medium) and domain raised F-DG6-460 (Low). Both were routed to repair tasks, and all of them are merged (D-222 to D-225). The handbacks are in `docs/delivery/handbacks/DG6/T-DG6-{BE-Z12,BE-Z12B,ARCH-16}-*.md`, with evidence in the matching `-evidence/` folders.
- The diff since round 7 is `git diff 70f05ed49d893378efc99cd3e1a4027fc77697e8..d84d11a62f52932dd5c0aa932c5c1790c13e7e8b`. Review all of it, not only the lines a finding names.
- New since round 7:
  - BE-Z12 (F-DG6-480): a schema-derived inventory of every column that can reference a sensitive record (`apps/api/test/support/sensitive-reference-inventory.ts`) with a catalog test that fails on an unclassified column; D-218 redaction extended to the rows it found (approvals, benefits, governance, KPI versions, launch, procedures, RAID, sustainment and others); the re-save rule on the benefit and launch-task PATCH; a write that sets a hidden reference answers as for an unknown id;
  - BE-Z12B (D-222, D-223): restricted work items and My Work rows carry no subject/record id (`WorkItem.subjectId`, `MyWorkItem.recordId` now `NullableUuid`), link to the transformation home and carry the marker, assignee included; automation condition literals naming a hidden record show the restricted marker and survive a re-save; the six PENDING inventory rows are seeded and tested; the inventory pins zero open and zero PENDING rows;
  - ARCH-16 (F-DG6-460, D-224): ADR-0051 and ADR-0045 amendments, OpenAPI descriptions, data dictionary and ERD for BE-Z9 to BE-Z12B.
  - Challenge D-222 to D-224 if you can show a disclosure or a misleading screen.

## Verify your open findings on THIS candidate, adversarially

- **None open from your earlier rounds.** Write the verifications file with an empty list and say so.

For each one:
1. Re-run the reproduction from the round in which it was raised on this candidate (the real stack where the finding was observed there).
2. Where practical, run a mutant that reverts the fix, to show that the test catches it.
3. Read each finding in full in `docs/delivery/findings.json` and in the sidecar that raised it.

Write `docs/delivery/reviews/DG6/round-8/qa-verifier.verifications.json` = `{ "verifications": [ {finding_id, result, status_after, note, evidence[]} ] }`, where `status_after` is CLOSED_VERIFIED or OPEN. Your verdict can be PASS only if every one of them verifies CLOSED_VERIFIED. Then run your full review of this candidate.

- **Judge these open questions the orchestrator did not decide (D-225).** If you judge one a defect, raise it as a finding with a severity; if not, explain why in a check's `actual`:
  - Re-run the BE-Z12/BE-Z12B before-and-after evidence yourself, and the My Work and automation screens with a restricted item, in both locales.

## Your focus: derive checks from the acceptance criteria of all 48 DG6-final requirements

Run positive, negative, regression, bilingual and reliability checks, and test every `acceptance` text **literally**.
- **Tests you may write:** under `docs/delivery/test-evidence/DG6/qa/tests/round-8/`, never in the candidate tree (the candidate is frozen). Never touch product code.
- **Evidence:** under `docs/delivery/test-evidence/DG6/qa/round-8/`.
- **The executable acceptance suites in the candidate.** `tests/qa/**` and `e2e/**` hold A01, A12, A13, A14, A17, A20, A21 and A22 for P6, plus the DG2–DG5 suites. Each QA authoring handback has a requirement → test table. The authoring tasks were not the gate review; you are.
  - Re-run the suites.
  - Read each test, and check that it asserts its row's clause.
  - Probe beyond them wherever a clause is untested or only partly tested; the register `notes` say where.

### Execute, with real output

A missing tool or database is BLOCKED.

1. **Static:** `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm format:check`, and `pnpm --filter @mth/design-tokens run check:contrast`.
2. **Unit:** `pnpm test` on Node 22 and Node 24, in both locale settings.
3. **Integration:** run it on a disposable PostgreSQL, **twice**. It covers migrations `0001`→`0125` and `contract/contract.test.ts` (record the operation count it reports; `docs/api/openapi.yaml` has 932 `operationId`s; every `p6-pending-*.ts` list empty). Then run `tests/qa` on its own.
4. **e2e:**
   - run the product journeys (`apps/web/e2e`) and the root acceptance specs on the real stack, `--workers=1`:
     - on `apps/web/e2e/support/with-stack.sh`, by explicit paths: `a03-modular-entry`, `a04-kpi-update`, `a06-configuration-change`, `a07-historical-integrity`, `a08-a09-gates-decisions`, `a12-p6-scope-isolation`, `a13-automation-recovery`, `a13-connector-run-once`, `a14-compare-reapply`, `a15-reporting`, `a16-health-launch`, `a17-failing-connector-exception`, `a17-import-and-integration`, `a20-bilingual-shell`, `a20-p6-axe`, `a20-p6-layout-brand`, `a20-p6-ux`, `a20-s15-014-term-scan`, `a21-no-ai-operation`, `a21-p6-degradation`, `a22-operations-jobs` and `a22-p6-operability`;
     - on `e2e/support/with-demo-stack.sh`: `a02-demo-labels`, `a02-demo-users-walkthrough` and `a02-guided-walkthrough`;
   - in **chromium-en and chromium-ar**, in both locale settings;
   - axe must report no serious or critical issues;
   - include an AUD read-only pass;
   - check 360 px, 390 px and 200 % text on the P6 screens.
5. **Reliability:** the A13 kill-and-restart drills (reindex, connector run, import commit, channel delivery); a worker burst that shows the batch throughput (D-203) without a duplicate execution; the load and async-export measurements of REQ-S20-029 and REQ-S20-030, labelled provisional.
6. **Register and pipeline:**
   - `node tools/gates/validate.mjs --register DG6`;
   - `--pipeline`;
   - `--historical --stage DG5`.

## Requirements to check (record EXACTLY these, 48)

`REQ-DLV-038`, `REQ-S01-005`, `REQ-S02-006`, `REQ-S10-002`, `REQ-S10-004`, `REQ-S12-019`, `REQ-S12-023`, `REQ-S12-024`, `REQ-S13-011`, `REQ-S13-013`, `REQ-S15-001`, `REQ-S15-003`, `REQ-S15-007`, `REQ-S15-009`, `REQ-S15-010`, `REQ-S15-011`, `REQ-S15-012`, `REQ-S15-013`, `REQ-S15-014`, `REQ-S16-006`, `REQ-S16-007`, `REQ-S16-022`, `REQ-S16-023`, `REQ-S16-026`, `REQ-S16-027`, `REQ-S16-029`, `REQ-S16-030`, `REQ-S16-032`, `REQ-S17-001`, `REQ-S17-002`, `REQ-S17-003`, `REQ-S17-005`, `REQ-S17-006`, `REQ-S17-007`, `REQ-S17-008`, `REQ-S17-009`, `REQ-S17-010`, `REQ-S17-011`, `REQ-S20-001`, `REQ-S20-012`, `REQ-S20-013`, `REQ-S20-014`, `REQ-S20-017`, `REQ-S20-020`, `REQ-S20-021`, `REQ-S20-022`, `REQ-S20-029`, `REQ-S20-030`.

## Evidence honesty (DG2 round-10 audit condition 1, binding)

- In your record, report every non-zero exit, failed suite, hook timeout, skipped or flaky test, or error line that appears in any log you cite. Explain each one, whatever its cause, in the check's `actual`.
- A check whose evidence holds an unexplained failure cannot be PASS.
- A probe that exits non-zero "by design" must say exactly which assertions failed and why.

## Environmental residuals: NOT BLOCKED gate checks

Record each of these as PASS on the offline/config surface, and note the residual. A BLOCKED check fails the gate round.
- Live registry: REQ-DLV-042 AC-1, D-057.
- Live CI: REQ-DLV-025 A24, D-058.
- Keycloak and a real enterprise IdP: D-049. The OIDC clauses are tested against the bundled test issuer (REQ-S16-007); the SAML broker is documented, not run.
- External systems: no real Mobily system, mail server, messaging service or AI provider is reachable. Connectors, outbound writes, notification channels and the assistant are exercised through their test adapters and the shipped "disabled" configuration (ADR-0055, ADR-0054, ADR-0059).
- Production capacity: the REQ-S20-029 and REQ-S20-030 targets are provisional engineering targets measured on one sandbox host, not verified Mobily capacity (the register notes).

## Record format (MANDATORY)

Write `docs/delivery/reviews/DG6/round-8/qa-verifier.json` with these fields:

- `assignment` = exactly `docs/delivery/assignments/DG6/round-8/qa-verifier.md` (bare path);
- `candidate_id` as above; `source_commit` as above;
- `reviewer_role: qa-verifier`, `round: 7`, `stage_id: DG6`;
- `checks_run[]`, each `{id, environment, procedure, expected, actual, exit_status (int), result (PASS|FAIL|BLOCKED), evidence[]}`;
- `requirements_checked[]`: exactly the ids listed above;
- `findings[]`: only the ids of NEW findings (strings);
- `verdict`: PASS only if all four hold:
  - every requirement you check is verifiable with evidence;
  - every failure in the logs you cite is disclosed and explained;
  - nothing Critical, High or mandatory is unresolved;
  - you raised no finding you consider blocking.

Mirror the field set of `docs/delivery/reviews/DG5/round-1/qa-verifier.json`. Put your evidence under `docs/delivery/test-evidence/DG6/qa/round-8/`.

## Finding record format: STRICT (use YOUR id range only)

- **Your id range for any NEW finding:** **F-DG6-560 to F-DG6-579**, used in order. Never use another id. The other reviewers have their own ranges.
- **The sidecar.** If you raise findings, write `docs/delivery/reviews/DG6/round-8/qa-verifier.findings.json` = `{ "schema_version": 1, "findings": [ ... ] }`. If you raise none, set `findings: []` and write no sidecar.
- **Each finding object has EXACTLY these keys, and no others.** `locations` is NOT allowed:
  - `id`;
  - `stage_id` ("DG6");
  - `requirement`;
  - `severity` (Critical|High|Medium|Low);
  - `mandatory_violation` (bool);
  - `title`, `reproduction`, `expected`, `actual`;
  - `evidence` (array of repository paths);
  - `reported_by` ("qa-verifier");
  - `reported_in` ("docs/delivery/reviews/DG6/round-8/qa-verifier.json");
  - `owner` (an implementer role: backend-workflow-engineer | kpi-benefits-engineer | frontend-ux-engineer | solution-architect | transformation-analyst | devops-engineer);
  - `status` ("OPEN");
  - `history` (`[{at, status:"OPEN", note}]`).

**Severity guidance.**
- **High or mandatory** is a broken acceptance criterion, a security or authorization hole, a wrong financial result, or a business approval that can be fabricated or bypassed.
- **Medium** must be repaired before the gate (D-192): it cannot be accepted as an observation. Use it for a real defect with a bounded effect.
- **Low** is cosmetic, or a documentation drift with no behavioural effect.
- Be precise. An observation you do not consider a defect belongs in a check's `actual`, not in a finding.
