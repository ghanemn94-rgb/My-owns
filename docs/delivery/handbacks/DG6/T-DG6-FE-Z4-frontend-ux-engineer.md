# Handback T-DG6-FE-Z4 (frontend-ux-engineer): DG6 V9 e2e failures after round-6 repairs

- Stage: DG6 (P6 "Integration and system hardening"), FIXING after review round 6.
- Invocation: `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-FE-Z4-frontend-ux-engineer-20261107T234632Z-cec45c1a","session_id":"cec45c1a-463d-4ff9-be34-0fdb2992e8b5"}`
- Assignment: `/home/user/My-owns/docs/delivery/assignments/DG6/T-DG6-FE-Z4.md` (sha256 `0ab78d1c…f0c38b23`, verified).
- Start revision: `0a6d54977` on branch `dg6/fe-z4` (clean tree at start). Started `2026-11-07T23:46:45Z`, ended `2026-11-08T00:41:15Z` (`99-end-time.log`).
- The changes are left **uncommitted**, as the brief asks.
- Evidence directory: `docs/delivery/handbacks/DG6/T-DG6-FE-Z4-evidence/`.

## 0. Contradictions in the brief (agent-protocol: "say so, do not guess")

1. **Handback path.** The brief says to write `docs/delivery/handbacks/DG6/T-DG6-BE-Z8-backend-workflow-engineer.md` with evidence under `T-DG6-BE-Z8-evidence/`. Both already exist and belong to task T-DG6-BE-Z8 (backend-workflow-engineer). Overwriting them would destroy another task's records, so this handback uses the protocol's default path for this task (`T-DG6-FE-Z4-frontend-ux-engineer.md`, evidence in `T-DG6-FE-Z4-evidence/`). The BE-Z8 files are untouched.
2. **Acceptance 3 (integration files)** lists the worker-job, failure-queue, automation-recovery, operations, operational-exception and BE-Z6 race files. That list matches BE-Z8's scope, and this change touches no integration file. I ran the named groups anyway (§3, `30-integration-named.log`).
3. **"Pending operations"**: this task routes no operation, so the `p6-pending-*` and `p6-exercises-*` delta is empty (§4).

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/e2e/p6-report-restricted-totals.spec.ts` | The F-DG6-440 regression now runs on the standard production-initialized stack (`with-stack.sh`) of the full web suite. It creates its own SYNTHETIC users and records, instead of using the `seed-demo` role users `roaming.user.*`, which that stack does not have (V9: dev-login 401). The assertions are unchanged. Header comment and measured budget updated. |
| `docs/delivery/handbacks/DG6/T-DG6-FE-Z4-frontend-ux-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG6/T-DG6-FE-Z4-evidence/**` | Logs and screenshots cited here. |

No product code (`apps/web/src`, `apps/api/src`, `packages/**`) changed. Section 2.2 explains why.

## 2. Behaviour delivered

### 2.1 `p6-report-restricted-totals.spec.ts` (F-DG6-440; REQ-S10-002 by way of FE-Z3)

**Repo convention.** Specs under `apps/web/e2e/` run on `apps/web/e2e/support/with-stack.sh` (seed-dev only). Demo-database specs are the root `e2e/a02-*` specs on `e2e/support/with-demo-stack.sh`, and that directory belongs to qa-verifier. Specs in `apps/web/e2e/` that need special roles build them themselves, as `p6-report-aggregate-label.spec.ts` (BE-Z9) does. The spec now follows that pattern:

- `dev.lead` creates a transformation. It is the TL there: no grant, not admitted to sensitive records.
- A synthetic Benefit Owner (`syntheticUser`, BO role on that transformation) adds two financial SAR benefits of different value classes (`revenue_uplift`, `avoided_cost`). The benefits register therefore has one totals section per class, with one row each (`registers.ts` `benefitTotalSections`: counted, monetised benefits).
- `dev.office` (TO, admitted) marks the `revenue_uplift` benefit sensitive. That section is then fully restricted for the TL, which is the case in the finding.
- Every original assertion is kept unchanged:
  - API totals are identical for the TL and the TO;
  - live preview and snapshot keep the header, the empty cell and the totals row;
  - the label "Includes restricted records" / "يشمل سجلات مقيدة" is shown;
  - html lang/dir match the language;
  - axe reports 0 serious/critical issues;
  - the TL's DOM never names the benefit id;
  - the benefit is unmarked at the end.
  - Browser contexts are closed at the end.

**Results:**

- **After:** passes in chromium-en and chromium-ar: `03-after-restricted-totals.log`, and again in `05-after-e2e-regression-set.log`.
- **Still fails without the FE-Z3 fix:** I temporarily replaced `apps/web/src/pages/reports/ui.tsx` with its `cf59bad63^` version, rebuilt the web bundle and ran the spec. It fails in both projects with `live: the TL's totals rows equal the TO's` ("TL totals rows 1, TO 2", the finding's symptom): `04-restricted-totals-without-fez3-fix.log`, exit 1. Afterwards I restored `ui.tsx` (git diff empty), rebuilt it, and ran `pnpm -r build` again (`13-build.log`).
- **Budget:** 240 s, unchanged. Measured loaded worst case 9.9 s (chromium-en, while a 229-test e2e run shared the machine, log 03). It was 9.5 s while `pnpm test` ran (log 05). 240 s is more than 20x that. The budget is written into the spec header.

### 2.2 `p5-title-reflow.spec.ts:70`: root cause is disk exhaustion from Playwright trace artifacts, not a product regression

**What I found.**

1. **Passes in isolation on HEAD.** At `0a6d54977` (which contains BE-Z9, BE-Z10, BE-Z10B, FE-Z3 and BE-Z11), the spec passes in both projects on a fresh stack: `01-before-both-specs.log` (title-reflow ✓ en 35.7 s, ✓ ar 35.0 s).
2. **Passes after the V9 suite prefix.** I reproduced the V9 suite state: chromium-en, `C.UTF-8`, the A17 secret env, and every `apps/web/e2e` spec in name order up to and including title-reflow (229 tests, the same position as V9's test 229). Title-reflow passed (35.6 s): `02-before-suite-prefix-en-cutf8.log`.
3. **The disk filled during that run.** While it ran, free space on `/dev/vda` fell from 3.8 GB to **283 MB (100 %)**. `test-results/fez4-prefix/.playwright-artifacts-0/traces` reached **3.1 GB in 36,480 files**. These are trace recordings Playwright keeps (with `trace: "retain-on-failure"`) for the life of the worker. With `--workers=1` and no failures, one worker runs a whole project, so they accumulate until the project ends. Then they are removed, and free space went back to 3.5 GB.
4. **Something else failed at the low point.** Near the low point, a full-page screenshot failed in `p5-shell.spec.ts:68` ("Page.captureScreenshot: Unable to capture screenshot", test 215; log 02). That spec has nothing to do with benefits.
5. **The V9 logs show the same pattern:**
   - The failures fall at exactly the same position in each project: en test 229 and ar test 508 (that is, 229 + 279).
   - Both V9 logs contain `browserContext._wrapApiCall: ENOSPC: no space left on device, write` attached to the title-reflow failure.
   - The cutf8/en failure lasted 4.0 s in total with no "Timeout: 5000ms" line. A real missing `h1` waits the full 5 s, so this points to the browser context failing, not the page.
   - In the unset run, en passed and ar failed. Title-reflow is the heaviest screenshot user at that point (full-page shots at 390, 320 and 200 %), so it is where the last free space runs out.
   - V8 (`orchestrator-final-9fbfea0`) ran the same order and passed. The host had more free disk then.
6. **Code check.** On the benefit page and the overview, the `h1` comes from `WorkspaceFrame` / overview → `useTransformation` + `useMethodology`. No merge since `9fbfea063` touched those routes or schemas. The BE-Z10 schema additions (`includesRestrictedRecords`, `countedBenefitRestricted`) are optional and are handled where the web reads them. The redaction in `transformations/routes.ts` only affects history events.

**Conclusion.** No product merge broke these pages, and I made no product code change. I won't invent a product fix for a defect that doesn't exist.

**What the orchestrator should decide.** `playwright.config.ts` is ADR-0012 / DG1, outside FE scope, so I did not edit it. Each of these options removes the failure:

- (a) Ensure at least about 8 GB free before a full-suite run. Each project's single worker needs about 3.1 GB by test 229, and more by the end of the project.
- (b) Run the full suite with `--trace=off`.
- (c) Use a lighter config: `trace: { mode: "retain-on-failure", screenshots: false }`. I did not measure its size.
- (d) Run one Playwright invocation per spec file, as `e2e/support/run-spec-order.sh` does. The worker, and its artifacts, then end with each file.

The final free-space figure on this host was 3.5 GB, which is below the full suite's peak need, so the next V-run will hit the same ENOSPC unless one of these is done.

## 3. Checks actually run (all on this tree, Node 24.21.0, offline; harness ports 31050–31099)

| # | Command | Result | Log |
|---|---|---|---|
| hist | `node tools/gates/validate.mjs --historical --stage DG5` (start and end) | `PASS gate DG5 (historical)`, exit 0 both times | start: console at 23:46Z; end: `90-validate-historical-DG5-end.log` |
| 01 | `with-stack.sh npx playwright test p5-title-reflow p6-report-restricted-totals` (before) | exit 1. Title-reflow ✓ en, ✓ ar. Restricted-totals ✘ en, ✘ ar (`dev-login roaming.user.to` 401, as in V9) | `01-before-both-specs.log` |
| 02 | V9-order suite prefix, chromium-en, C.UTF-8, 50 spec files / 229 tests | exit 1. 228 passed. Title-reflow ✓ 35.6 s. 1 failed: `p5-shell.spec.ts:68` "initiatives" screenshot capture at the disk low point (environment, §2.2) | `02-before-suite-prefix-en-cutf8.log` |
| 03 | restricted-totals (after), both projects | exit 0, 2 passed (en 9.9 s, ar 8.6 s) | `03-after-restricted-totals.log` |
| 04 | restricted-totals with FE-Z3's `ui.tsx` reverted (temporary) | exit 1, 2 failed as expected (TL 1 totals row, TO 2) | `04-restricted-totals-without-fez3-fix.log` |
| 05 | e2e regression set, both projects: `p4-benefits`, `p4-value-headlines`, `p4-value-rag-lines`, `p4-dashboards`, `journeys` (overview), `p5-reports-exports`, `p5-snapshot-page`, `p5-title-reflow`, `p6-report-aggregate-label`, `p6-report-restricted-totals`, `e2e/a15-reporting`, `e2e/a22-p6-operability`, `e2e/a13-automation-recovery` | exit 0, **84 passed** (14.1 min), 0 flaky | `05-after-e2e-regression-set.log` |
| 10 | `pnpm -r typecheck` | exit 0 | `10-typecheck.log` |
| 11 | `pnpm lint` | exit 0 | `11-lint.log` |
| 12 | `pnpm openapi:lint` | exit 0 | `12-openapi-lint.log` |
| 13 | `pnpm -r build` | exit 0 | `13-build.log` |
| 14 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0 | `14-prettier.log` |
| 20 | `pnpm test` (LANG, LC_ALL, LC_CTYPE unset) | exit 0. unit-node 190 files / 2899 tests; unit-web 123 / 2077; formula-nocodegen 3 / 259 passed + 2 skipped | `20-pnpm-test-locale-unset.log` |
| 21 | `pnpm test` (`C.UTF-8`) | exit 0. Same counts: 2899, 2077, 259 + 2 skipped | `21-pnpm-test-cutf8.log` |
| 30 | `tests/qa/support/with-pg.sh npx vitest run --project integration` over `apps/api/test/integration/operations/**` (incl. exception-recurrence-race and concurrent-exception-recurrence), `jobs/job-operations`, worker `automation-failure-queue`, `operations-freshness`, `worker-attempt`, `access/sensitive-reach-dashboards-reports` | exit 0, **12 files / 88 tests passed** | `30-integration-named.log` |

**Notes on these runs:**

- The 2 skipped formula tests are skipped in the repo as it stands. This task did not cause them.
- The full `pnpm test:integration` was not run, per the brief.
- No integration file contains "automation-recovery"; the A13 automation-recovery coverage is the e2e spec in run 05 and the worker failure-queue file in run 30.
- **Non-zero exits, explained:**
  - 01 is the reproduction of the restricted-totals failure.
  - 02 has one environment failure (disk), §2.2.
  - 04 is the intended "fails without the fix" check.
- **Visual evidence (the spec's own shots, copied):** `T-DG6-FE-Z4-evidence/screenshots/{en,ar}-fez3-tl-{live,snapshot}-restricted-totals.png`. They show the TL's fully restricted revenue-uplift section with the restricted label, the empty cell and its totals row, in English LTR and Arabic RTL. I made no visible UI change, so these document the spec, not a new screen.

## 4. Operations routed (pending-list delta)

None. This task added no API operation; the `apps/api/test/support/p6-pending-*.ts` and `p6-exercises-*.ts` delta is empty.

## 5. Contract, schema or dependency needs

- No contract, schema, migration or dependency change.
- One harness decision is needed from the orchestrator: the trace and free-disk options in §2.2.

## 6. User-facing texts made untrue

None. No en/ar string changed or became untrue.

## 7. What remains

- The orchestrator chooses the trace / free-disk handling for full-suite runs (§2.2) and reruns V-verification. Title-reflow will keep failing on any host where Playwright's per-worker traces exhaust the disk; this is not a product defect.
- Any spec at that point in the order (as `p5-shell` showed in run 02) can fail the same way.
- The orchestrator decides about the handback-path mismatch (§0.1).

## 8. Merge instructions

- One modified spec plus new handback and evidence files.
- No migration. No ordering constraints. No expected conflicts. Gates: no G1–G6 business approval was granted or simulated beyond synthetic test data; DG gates were not touched.
