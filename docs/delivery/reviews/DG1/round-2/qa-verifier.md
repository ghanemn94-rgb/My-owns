# DG1 round 2: qa-verifier narrative

- **Candidate:** `sha256:e6979e12111aeb1456f591d66f8437d9f491c7e8e58215ea7c5a9f233cbfe71d`, 394 files. Recomputed on the working tree, at 485e91f and at HEAD 309be8d (the HEAD delta is metadata only).
- **Run:** `DG1-T-DG1-REV-QA-R2-qa-verifier-20261001T214241Z-80d81177`.
- **Verdict: FAIL.** One finding, Low and non-mandatory: F-DG1-232. Everything else passed.

## Round-1 findings (raised by qa-verifier)

| Finding | Result | Basis |
|---|---|---|
| F-DG1-230 | CLOSED_VERIFIED | The data dictionary has a "Views (read models)" section. The ERD lists the three views and the 0009 guard trigger. A live check on a freshly migrated DB matched 3 views and 11 columns/types, owner `mth_owner`, with SELECT only for `mth_app` (log 26). |
| F-DG1-231 | CLOSED_VERIFIED | The REQ-DLV-033 and REQ-S19-004 rows have no 991d3241/f32c705 references and no conditional status. All 30 cited files exist, and no carried round-2 logs are tracked. Their factual claims (9 migrations; integration 209/209 twice) hold in my own runs. |

## What ran (disposable clone, Node 22 unless noted; logs in `docs/delivery/test-evidence/DG1/qa/round-2/`)

- **Static checks:** typecheck, build, lint, `openapi:lint` (33 ops), no-cdn, format, contrast. All exit 0.
- **Unit tests:** 326/326 on Node 22 and on Node 24. The web transformations file passed 21/21 in each of 6 parallel runs under load.
- **Integration:** 209/209 in two runs, each on its own disposable cluster and port.
  - 9 migrations applied.
  - `bu-hierarchy-guard.test.ts` passed 7/7.
  - The contract suite passed 9/9, including getBrandingTokens.
  - No 57P01 errors and no hook timeouts.
- **DB probe:**
  - `audit_event` UPDATE, DELETE and TRUNCATE were refused for the app, owner and superuser roles.
  - The 0009 guard refused a direct cycle and the second transaction of a two-session race (23514 `business_unit_acyclic`). It also refused level 11 (`business_unit_max_depth`).
- **API black-box probe (new):**
  - Branding tokens: 401 without a session; 200 with the seven exact values and `provenance: provisional`.
  - Re-parent race through the API, 25 trials: both interleavings were observed, but both updates never committed together and no cycle was created.
  - The API refused the 11th level (400 `business_unit.depth_exceeded`).
- **Acceptance suites:**
  - A12/A13/A14: 24/24.
  - A18 clean start: PASS with 9 migrations.
  - A20: propagation PASS; bilingual shell 4/4.
  - Worker-stop probe: PASS.
  - Round-1 black-box rerun: PASS.
- **Validators:** `--register`, `--pipeline` and `--reconcile` all PASS.
- **REQ-DLV-025 (CI):**
  - `check-ci-needs` reports OK, and the two ci.yml copies are identical.
  - Script tests: 46/46.
  - All three of my negative mutations were detected.
  - A tampered gate record makes `validate.mjs --pipeline` exit 1.
  - Not checked: the live GitHub Actions run, which is residual D-058.
- **REQ-DLV-042 (install sandbox):** 13/14 offline. AC-1 (effect) needs the public registry, which is residual D-057. The first attempt scored 8/14 only because the shared pnpm store is read-only in this sandbox; with a writable scratch copy of the store the result matches D-057.

## F-DG1-232 (Low, non-mandatory; owner frontend-ux-engineer)

**What failed:**
- The first full journey run failed one test: `[chromium-en] shell: navigation, language persistence and My Work`, at `toBeFocused` on the skip link.
- The spec runs in serial mode, so the remaining 7 EN journeys did not run.
- On a loaded host it failed 1 time in 15. Without load, 28 of 29 executions of this test passed.

**Cause:** after `page.reload()` the test waits only for `html[lang]`. `locale-boot.js` sets that attribute before the first paint, so the test can press Tab before the shell has mounted.

**Fix:** after the reload, wait for a post-mount element before pressing Tab, for example the navigation or the heading.

**Why the verdict is FAIL:** this is not a product defect. But the required gate check is non-deterministic (`retries: 0`), and that run is honestly recorded as FAIL, so this record cannot be PASS. No Critical, High or mandatory issue is open.

## Observations (not findings)

- The REQ-S16-004 register note still says it was "re-checked against migrations 0001-0008", and its evidence list omits 0009. Migration 0009 adds only a trigger and no new persistent state, so the row's claim still holds.
- The live-registry install effect (D-057) and the live CI run (D-058) are not claimed as verified. Only their offline surfaces were checked.
