# Handback T-DG3-FE-D: P3 end-to-end journeys on the real stack, including G4 end to end (frontend-ux-engineer)

- **Stage:** DG3 (P3 "Mobilization and portfolio"), BUILDING. This is engineering delivery work only. Every business decision in the journeys (the G1, G2, G3 and G4 approvals, the weight-set approval, the selection, the Finance validations, the funding decision, the capacity commitment) is a **synthetic demo record that approves nothing real**. Product gate G4 (or any G1–G6) never implies any engineering gate DG0–DG7, and product G6 never implies DG7.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG3-T-DG3-FE-D-frontend-ux-engineer-20261008T040354Z-198a080a","session_id":"198a080a-e7f9-4808-abe4-41a821ada7fc"}`
- **Assignment:** `docs/delivery/assignments/DG3/T-DG3-FE-D.md`. Before starting I checked its sha256 with `sha256sum`: `fc2bc6293a0d7b67105e60b96854decc145baebd7cf0554fce7e7686a6722a1f`. It matched.
- **Worktree and base:** `/home/user/wt/dg3-fe-d`, branch `dg3/fe-d`, base `HEAD` `f779a7be368753344f65149bde5b4024eba906ee`. Nothing is committed; the changes are in the working tree for the orchestrator to integrate.
- **Time:** started `Thu Oct 8 04:04:06 UTC 2026` (`date -u`) and ended at `Thu Oct 8 05:22:49 UTC 2026` (`date -u` after the final prettier check), about 79 minutes in total. All seven journeys were built in the assigned order, so the 100-minute cut-off was not reached.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG2` printed `PASS gate DG2 (historical)` and exited 0, at the start and again at the end (`T-DG3-FE-D-evidence/validate-dg2-historical-{start,end}.log`).
- **Write scope:** I touched only:
  - `apps/web/e2e/p3-journeys.spec.ts` (new);
  - `apps/web/e2e/support/p3-journey-setup.ts` (new; no existing support file was edited);
  - the screenshots `apps/web/e2e/screenshots/{en,ar}/p3-journey-*.png` and `axe-summary-p3-journey.json` (the directory is gitignored; tracked copies are in `T-DG3-FE-D-evidence/screenshots/{en,ar}/`);
  - this handback and `T-DG3-FE-D-evidence/`.

  I made **no product fix**: no journey exposed a web defect, so `apps/web/src/**` is unchanged. `apps/api/**` and `packages/**` were not touched. I removed the empty harness `.claude/.cc-writes` directories before every test run (the run script does `find apps packages -type d -name .cc-writes -empty -delete`).

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/e2e/p3-journeys.spec.ts` (new) | One serial, continuous story per project (chromium-en, chromium-ar): 18 tests (setup + journeys 1–7). |
| `apps/web/e2e/support/p3-journey-setup.ts` (new) | Setup helpers through the real API: synthetic dev-issuer users with one transformation-scoped role; the G1, Define, G2 and G3 records (P2-covered setup, as the P2 specs do); `submitAndApprove` for G2/G3; `asUser`. |
| `docs/delivery/handbacks/DG3/T-DG3-FE-D-evidence/**` | Logs of every check in §4 and the tracked screenshot copies. |

## 2. Users and data (binding rules)

All users and data are synthetic. **Distinct people per role:**

| Role in the story | User | How |
|---|---|---|
| TL: drafts, edits, scores, proposes, submits (initiative and gates), launches | `dev.lead` | seed-dev (TL on SYN-RETAIL) |
| FIN: validates both case baselines and the formula versions, records the funding decision | `dev.p3j.fin.<lang>.<stamp>` ("Synthetic Finance EN/AR") | created in setup, FIN on **this transformation only** |
| SP: approves G1 (with the three confirmations), weight set v2, the selection, the T02 trajectory, G2, G3 and G4 | `dev.p3j.sp.<lang>.<stamp>` ("Synthetic Sponsor EN/AR") | created in setup, SP on **this transformation only** |
| Capacity owner: role, capacity, raising capacity, committing demand | `dev.office` | seed-dev (TO, which holds `capacity.commit`) |
| AUD: read-only pass | `dev.auditor` | seed-dev |
| Evidence reviewer for the G1 baseline note (P2 setup) | `dev.office` | seed-dev |

**Deviation, stated plainly:** seed-dev creates only five users (`dev.admin`, `dev.office`, `dev.lead`, `dev.auditor`, `dev.nobody`), and none of them holds FIN or SP. The earlier P3 specs gave `dev.office` SP or FIN, which would make one person act in several roles. Granting `dev.nobody` a role would break `journeys.spec.ts`, which asserts that `dev.nobody` has no roles and runs in the same stack. So setup creates two **additional synthetic development users** through the real admin API (`POST /api/v1/users` with the development issuer `urn:mth:dev-local`, then `POST /api/v1/role-assignments` scoped to the journey's transformation, with a "Synthetic demo … approves nothing real" reason). A third synthetic user holding **both TL and SP** is created only in 6b for the one refused separation-of-duties decision (see §3.6). It approves nothing.

## 3. Journeys and the acceptance texts they assert

Each test runs in chromium-en and chromium-ar. Texts are asserted from the catalogue in the project's language (`tr(lang, key)`); where the assignment quotes English text it is asserted literally in EN, and in AR the G4 refusal is also asserted **not** to contain the English labels. Every milestone state is screenshotted in EN and AR and checked by axe (WCAG 2.0/2.1 A+AA): 0 serious or critical issues on all 49 states per language. Every request stays on the application origin (`trackRequests`).

### 3.1 Journey 1: sequencing (REQ-PB-004, -006, -007, -022)

- **1a (UI, TL).** A draft "Synthetic order validation at entry" is created on the Portfolio screen before G1, and its card is filled through the edit form (objective, scope in, executive owner, workstream lead, wave, planned dates). "Submit for prioritization" is refused: the dialog's single alert has `data-problem="initiative.g1_not_approved"` and the text `portfolio.problem.initiative__g1_not_approved` (EN "Case for change not yet approved (G1)…", AR translated). Readiness lists the five missing diagnostic areas (`economics customer operations capability technology`), each with its translated label.
- **1b (UI, TL + SP).** The G1 records are P2 setup (API). TL submits G1 on the gate screen. SP decides "Approve" in the decision dialog, ticks the **three leadership confirmations** (problem, baseline, material value pools) by their translated labels, and enters a rationale. G1 is approved and the phase shows **Define**.
- **1c (UI, TL).** The Define records (a top outcome with an active KPI and a T02 row) are P2 setup (API). Submitting is refused with `initiative.outcome_before_activity`: the text is `portfolio.problem.initiative__outcome_before_activity`, and in EN it contains **"Outcome before activity"**. TL links the outcome **with its KPI** on the card (`data-has-kpi='true'`), and the submission is accepted (`data-status='submitted'`). B and C are submitted the same way through the API (setup).
- **1d (UI, TL; after journey 5, because a launch needs a funded initiative).** Launching the funded A is refused with `initiative.direction_not_approved`: the text is `portfolio.problem.initiative__direction_not_approved`, in EN **"North Star, outcomes and target state not yet approved"**. G2 and G3 are then recorded, submitted by TL and approved by SP through the API (P2-covered setup: North Star, thesis, guardrail, the T02 trajectory approved by SP; TOM canvas, a T03 gap, a capability gap, a future journey). A is linked to the T03 gap on its card (UI), and **the launch succeeds** (`data-status='launched'`, phase **Mobilize**).

### 3.2 Journey 2: prioritization (REQ-PB-047/048/049, REQ-S09-001/003/005)

- **2a (UI, TL).** A is scored **5, 4, 3, 2, 1** on the scorecard. The weighted score is **3.30**, and the ranked row shows 3.30. The 0–100 view shows **57.5** with the label `prioritization.conversion_label` ("0–100 view = (weighted score − 1) ÷ 4 × 100"). B and C are scored through the API (setup). Ranking snapshot #1 is recorded under weight version 1.
  - A proposal with strategic fit 20 (total **95%**) is refused live (`prioritization.problem.prioritization__weights_total` with 95.00), and **nothing is sent**.
  - **Weight set v2** (risk/compliance **10**, strategic fit **15**) totals 100% and is proposed.
  - An override proposed **without a reason** is refused inline (`aria-invalid` on the reason) and nothing is sent.
- **2b (UI, SP + TL).** SP approves v2 (business approval); the active weight set reads "weight version 2". TL scores A on risk/compliance (B and C through the API) and records snapshot #2. The ranking history shows `prioritization.cause.weight` with n=2, literally **"weight version 2"** in EN. SP selects A on its card (rationale required, business approval); the card shows **"Selected - unfunded"** (`portfolio.funding.selectedUnfunded`, `data-funding='unfunded'`).

### 3.3 Journey 3: roadmap and dependencies (REQ-PB-050/051/052, REQ-S09-006/008)

- **3a (UI, TL).** A milestone is created on A's card. The roadmap shows the four waves **verbatim** ("Wave 0 — Mobilize", "Wave 1 — Prove", "Wave 2 — Scale", "Wave 3 — Embed") and four horizons. TL approves the milestone's date (the baseline, with a reason), then moves the forecast to 20 Dec 2026: the **timeline, the initiative table and the work board show the same date**. A concurrent move (another session, API, to 22 Dec) makes TL's next move a **409**: the conflict banner `common.conflict.title` shows, and the timeline shows the other person's date.
- **3b (UI, TL).** A→B (needed by 15 Nov 2026; A finishes later) and B→C (needed by 31 May 2027; B ends 31 Mar 2027) are recorded. C→A is **refused naming the cycle** `INI-c → INI-a → INI-b → INI-c` in the dialog's alert. The A→B row is **flagged** with `roadmap.flag.schedule__needed_by_conflict` ("Needed-by conflict: the predecessor finishes after the date it is needed…"). It is then edited to status "At risk" with a mitigation. Every dependency has a needed-by date and both ends have planned dates, so the G4 approval does not depend on BE-F's `g4.schedule_unknown`.

### 3.4 Journey 4: business case and T09 (REQ-PB-053…057, REQ-S05-005, REQ-S08-007)

- **4a (UI, TL).** The revenue example is marked illustrative and **previews 100000 SAR** (`data-example-preview="100000"`, "SAR 100,000.00" / "100,000.00 SAR"). It is instantiated (BF-01). In the builder, **monthly ARPU with the annual population is refused**: the live check shows `formula.period_mismatch` with `benefitFormulas.engine.periodMismatch`, and "Save new version" saves nothing (no request sent, no `version-saved`). The cost-reduction example (500000) is instantiated too (BF-02), because the server allows one benefit line per formula.
- **4b (UI, TL).** The transformation case has **ten section fieldsets**; all are filled (text, the three owners, one decision ask) and saved. Lines: capex 1,250,000 and revenue 3,000,000 (BF-01). The initiative case of A (level "initiative") gets its sections, opex 400,000 and cost reduction 500,000 (BF-02). **Each line shows exactly one class** (`data-class`, translated). The transformation case **rolls the initiative case up once**: `data-roll-up='2'` with `businessCases.totals.rollUp` (count 1); gross **3,500,000.00**, cost **1,650,000.00**, net **1,850,000.00** SAR (each line counted once).
- **4c (UI, TL then FIN).** The author (TL) is **not offered** "Validate" on formula version 1, and `POST …/versions/1/validation` as TL answers **403**. FIN validates both case baselines and **version 1 of both formulas** (business approval): each shows `businessCases.finance.state.validated`.

### 3.5 Journey 5: capacity and funding (REQ-PB-059, REQ-S09-003/004)

- **5a (UI, capacity owner + TL).** The capacity owner (TO) creates the role "Order analyst (synthetic)" and 1.00 FTE for December 2026. TL adds A's demand of 2.50 FTE: the grid cell shows the **conflict indicator** (`data-flag='capacity.over_allocated'`, "Conflict: short by 1.5 FTE"). TL is not offered "Commit". The owner raises December to 3.00 FTE (the conflict clears) and **commits** the demand (`data-demand-status='committed'`).
- **5b (UI, FIN).** On A's card ("Selected - unfunded"), FIN records an approved funding decision (business approval: amount 1,650,000, source, rationale). A shows **Funded**.

### 3.6 Journey 6: G4 end to end (REQ-PB-019, REQ-PB-046, REQ-S04-006, REQ-DLV-035)

- **6a (UI, TL).** The G4 page shows 8 criteria, all complete, and TL opens the submit dialog. Meanwhile, in another session (API, simulating a colleague): A's workstream lead is cleared, and the initiative case's baseline is edited, so its Finance validation becomes Stale. TL confirms. The server refuses with `gate_criteria_incomplete`, and the dialog lists exactly two items:
  - `g4.owner_missing`: **"Owners — INI-a Synthetic order validation at entry"** (AR: "المالكون — …");
  - `g4.finance_validation_missing`: **"Finance validation"** (AR: "التحقق المالي").

  In AR the alert is asserted not to contain "Owners" or "Finance validation". After a reload, the live readiness shows the same two criteria as incomplete, and Submit is disabled with the blocked note.

  *Why the race:* the UI disables Submit while readiness is incomplete (the server's `canSubmit`), so the server-side refusal can only be reached from the UI when the data changes after the page loaded. The incomplete readiness itself is also asserted.
- **6b (UI + API).** TL restores the workstream lead on the card; FIN sees the case as **Stale** and re-validates it; TL resubmits (submission #1, `submitted`). Neither TL (the submitter) nor FIN is offered "Record decision". On the server:
  - FIN deciding → **403 `gate.not_approver`**;
  - TL (the submitter) deciding → **403 `gate.not_approver`**: TL holds no `gate.decide` in the seeded catalogue, so the approver check refuses first;
  - for the separation-of-duties rule itself, a separate synthetic user holding TL **and** SP resubmits (#2 supersedes #1) and decides their own submission → **403 `gate.submitter_cannot_decide`**. Nothing is decided; the gate stays `submitted`.
- **6c (UI, SP + TL).** SP opens the decision dialog for #2. TL resubmits through the UI (#3). SP's decision on #2 → **409** `gate.submission_superseded`, translated (`problems.gate__submission_superseded`), `data-state='conflict'`. SP then approves #3 with a rationale. The page states it is a business approval. G4 is **approved** and the phase shows **Transform**. No `DG0–DG7` text appears on the page.

### 3.7 Journey 7: AUD read-only pass

`dev.auditor` opens 13 P3 screens:

- portfolio, A's card, readiness and dispensations;
- prioritization, roadmap, dependencies and capacity;
- business cases, the transformation case, benefit formulas and BF-01;
- G4.

Each shows the journey's data and the read-only note. There are no `[data-transition]` buttons and **no enabled write control** in `main`. Reading aids are allowed: table headers, filters, pagination, the column picker, navigation, the 0–100 toggle, "Scorecard of INI-nn" (a read-only scorecard) and "View #n" of a gate submission. Read-only inputs count as not writable. **No non-GET request** is sent apart from the language preference. G4 shows approved.

## 4. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline; Chromium 1194 from `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; harness ports `QA_PG_PORT=23800`, `E2E_API_PORT=23801`, `MTH_PORT_POOL=23802-23849`. Every e2e run uses a fresh `with-stack.sh` stack (disposable PostgreSQL cluster, migrate, seed-dev, API). "Locale unset" means `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE` (the shell has no LANG/LC\_\* set either); "C.UTF-8" means `env LANG=C.UTF-8 LC_ALL=C.UTF-8`.

| Check | Command | Exit | Result (log under `T-DG3-FE-D-evidence/`) |
|---|---|---|---|
| Preceding gate (start) | `node tools/gates/validate.mjs --historical --stage DG2` | 0 | `PASS gate DG2 (historical)` (`validate-dg2-historical-start.log`) |
| Journeys, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p3-journeys.spec.ts --workers=1 --reporter=list` | 0 | **36 passed** (18 chromium-en, 18 chromium-ar), 3.2 min (`e2e-p3-journeys-locale-unset.log`) |
| Journeys, C.UTF-8 | same with `env LANG=C.UTF-8 LC_ALL=C.UTF-8` | 0 | **36 passed** (18 + 18), 3.3 min (`e2e-p3-journeys-c-utf8.log`) |
| Whole product e2e, locale unset | `env -u LANG … apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1 --reporter=list` | 0 | **164 passed**, 11.8 min (`e2e-full-locale-unset.log`) |
| Whole product e2e, C.UTF-8 | same with `env LANG=C.UTF-8 LC_ALL=C.UTF-8` | 0 | **164 passed**, 11.8 min (`e2e-full-c-utf8.log`) |
| Typecheck | `pnpm -r typecheck` | 0 | all packages, incl. `apps/web` `tsconfig.e2e.json` (`typecheck.log`) |
| Build | `pnpm -r build` | 0 | (`build.log`) |
| Lint | `pnpm lint` | 0 | `eslint . --max-warnings=0` (`lint.log`) |
| Formatting | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (`prettier.log`; re-run after the handback was written: `prettier-final.log`) |
| Contrast | `pnpm --filter @mth/design-tokens run check:contrast` | 0 | "PASS contrast: 50 pairs meet WCAG AA; 3 prohibited pairs fail as documented" (`contrast.log`) |
| Unit, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | 80 files, **1523/1523** (`test-locale-unset.log`) |
| Unit, C.UTF-8 | `env LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | 80 files, **1523/1523** (`test-c-utf8.log`) |
| Preceding gate (end) | `node tools/gates/validate.mjs --historical --stage DG2` | 0 | `PASS gate DG2 (historical)` (`validate-dg2-historical-end.log`) |

**E2E counts per spec and project** (`e2e-counts.txt`). The two full runs are identical:

| Spec | chromium-en | chromium-ar |
|---|---|---|
| `journeys.spec.ts` | 9 | 9 |
| `p2-blank-text.spec.ts` | 9 | 9 |
| `p2-journeys.spec.ts` | 12 | 12 |
| `p3-business-cases.spec.ts` | 6 | 6 |
| **`p3-journeys.spec.ts` (new)** | **18** | **18** |
| `p3-portfolio.spec.ts` | 6 | 6 |
| `p3-prioritization-roadmap.spec.ts` | 7 | 7 |
| `p3-seams.spec.ts` | 3 | 3 |
| `p3-ui-completion.spec.ts` | 7 | 7 |
| `session-end.spec.ts` | 5 | 5 |
| **Total** | **82** | **82** |

None failed, none was flaky, none was retried (`retries: 0`), and nothing timed out in the four cited e2e logs. During development I ran the spec iteratively against fresh stacks. Those failed runs were selector and expectation fixes while building the tests, not product failures:

- a second benefit line on one formula, refused by design ("one benefit is counted in one line only");
- `PUT` not `POST` for the North Star;
- the business-approval note sitting on the page, not in the dialog;
- reading aids in the auditor's write-control check.

One earlier attempt to keep a long-lived background stack failed with `ECONNREFUSED`, because each sandboxed command has its own network namespace. After that, every run starts its own stack.

**Axe:** `axe-summary-p3-journey.json` records **0 violations of any impact** on all 49 states in EN and all 49 in AR.

## 5. Backend defects and observations

No backend defect was reproduced on the real stack. Two observations:

1. **G4 refusal shape with several initiatives (code reading, not reproduced):** `submitGate` (`apps/api/src/modules/workflows/gates.ts`) returns **one** field error per incomplete criterion: `code` is the first missing item's code, and `message` is **all** of the criterion's messages joined with a space. With two in-scope initiatives without owners, the message would be `"Owners: INI-01 X Owners: INI-02 Y"`. The web's `g4Subject` takes everything after the first `": "`, so the refused-submission dialog would show "Owners — INI-01 X Owners: INI-02 Y" in one line. In AR, the second "Owners:" stays English. The live readiness table is not affected, because it lists each item separately. My journey has one in-scope initiative, so it does not exercise this. Suggested fix (backend): one field error per missing item, or a structured `items[]`. Reproduction: two selected initiatives without a workstream lead, submit G4 through the API, and read `errors[0].message`.
2. **"The author cannot validate" (REQ-PB-056) on the real stack:** in the seeded catalogue, the roles that may author a formula version (TL, BO, WL, KDS) do not hold the Finance validation permission. So the author's refusal is the permission's 403, and the web's `isAuthor` branch ("authorCannot") is reachable only by someone holding both roles. The journey asserts that no control is offered and that the API returns 403. It does not claim the separation rule was exercised.

## 6. Known gaps / not done

- No journey needed a product fix, so no web unit test was added.
- The 403/409 decision checks use the API for the refused callers (FIN, TL, the TL+SP user). The UI offers them no decision control, and that absence is asserted. The 409 is driven through the UI (SP's open dialog).
- Setup that P2 covers (the G1 records, Define records, and G2/G3 records with their submission and decision) uses the API, as the P2 specs do. G1's submission and decision use the UI. B and C are scored and submitted through the API; A goes through the UI.
- The full-page screenshots of open dialogs show the modal backdrop covering only the viewport height. That is how Playwright full-page captures a fixed overlay, the same as in the earlier specs; it is not a product defect.

## 7. Screenshots

49 states per language, each axe-checked: `apps/web/e2e/screenshots/{en,ar}/p3-journey-NN-*.png`, plus `axe-summary-p3-journey.json`. Tracked copies are in `docs/delivery/handbacks/DG3/T-DG3-FE-D-evidence/screenshots/{en,ar}/`.

`01-submit-before-g1`, `02-readiness-missing-areas`, `03-g1-confirmations`, `04-outcome-before-activity`, `05-submitted`, `06-scored-330`, `07-view-100`, `08-weights-95-refused`, `09-override-needs-reason`, `10-history-weight-v2`, `11-selected-unfunded`, `12-roadmap-waves`, `13-milestone-moved`, `14-milestone-409`, `15-needed-by-flag`, `16-cycle-refused`, `17-mitigated`, `18-t09-example-100000`, `19-t09-period-mismatch`, `20-initiative-case`, `21-transformation-case-roll-up`, `22-finance-validates-case`, `23-finance-validates-formula`, `24-capacity-conflict`, `25-capacity-committed`, `26-funding-dialog`, `27-funded`, `28-launch-before-g2-g3`, `29-launched`, `30-g4-ready`, `31-g4-refused`, `32-g4-readiness-missing`, `33-g4-submitted`, `34-g4-409-superseded`, `35-g4-decision`, `36-g4-approved-transform`, `37-aud-portfolio`, `38-aud-card`, `39-aud-readiness`, `40-aud-dispensations`, `41-aud-prioritization`, `42-aud-roadmap`, `43-aud-dependencies`, `44-aud-capacity`, `45-aud-business-cases`, `46-aud-business-case`, `47-aud-benefit-formulas`, `48-aud-benefit-formula`, `49-aud-g4` (each `p3-journey-<name>.png`, in `en/` and `ar/`). The copies are from the last full run (C.UTF-8).

## 8. Merge instructions

- New files only (one spec, one support helper, this handback and its evidence). There are no migrations and no dependency changes.
- No overlap with BE-F (`g4.schedule_unknown`) or the analyst (`requirements.csv`). If BE-F lands first, the journey still approves G4: every dependency has a needed-by date, both of its ends have planned dates, and the flagged one also carries a mitigation (into B, which is outside G4's scope).
- After merging, run `apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e --workers=1`. The full suite now has 18 more tests per project.
