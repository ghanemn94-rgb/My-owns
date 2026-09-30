# P2 QA final re-review — QA findings, P2 conditions C1–C5, and the exit criterion "block decisions outside authority"

| Item | Value |
|---|---|
| Reviewer | qa-test-engineer (independent; separate context; did not author the fixes under review) |
| Revisions tested | **`8f8d72b`** (`8f8d72b03db1d539987517d67b2a063a104d4a67`), head of `origin/claude/mobily-transformation-hub` when the review started, frozen for §2.1–§2.3, §2.4 run A and §3–§5 unless marked otherwise. Then, at the lead's note that the QA-P2-04 fix merged, **`88f1a88`** (`88f1a88c207c23352e4c90bd99a478343a08f1da`) was merged into the review branch as **`9b8d59f`** (= `88f1a88` + this review's test files, no other change) and the full suites were run again there (§2.4 run B) to verify C5 and to give results on the latest integration revision; the last full API run is at **`e2bce79`** (= `9b8d59f` + a rate-limit fix to this review's own probe file). Each result names its revision. |
| Review branch | `worktree-agent-ac3acb684fba72cfc` (adds this report, one API probe spec, one e2e spec, a comment in one earlier probe, and the screenshots of the new e2e spec; no implementation code changed) |
| Date | 2026-09-30 |
| Previous QA review | `docs/reviews/P2-qa-review.md` at `1b30f48`: FAIL (QA-P2-01 High) with conditions C1–C5 |
| **Verdict** | **PASS WITH CONDITIONS** (at `8f8d72b` and at `9b8d59f`) — QA-P2-01 (High) is fixed and holds under forced and plain concurrency; QA-P2-03 and F-03 are fixed; the exit criterion "block decisions outside authority" passes end to end in the UI in English and Arabic with the new rules, every dialog at 0 axe violations. C3 is met (CI green on `8f8d72b` and on `88f1a88`); C5 is met at `88f1a88` (not at `8f8d72b`). Open conditions: C1 (19 of the 23 P2 musts are neither Tested nor re-phased), C2 (final focused domain review still running), C4 (status documents partly stale), governance-owner confirmation of the proposed rules, and three new Low findings. See §8. |

---

## 1. Environment

- Worktree on `8f8d72b`; `git status` clean before the review.
- Node 22.22.2, pnpm 10.33.0, PostgreSQL 16.13 (shared local cluster on :5432, already running — not started or restarted),
  Playwright 1.56.1 + @axe-core/playwright 4.13.0 with Chromium from `/opt/pw-browsers`, 4 CPUs shared with other agents
  (load average 9–11 during the runs).
- Own databases only, created with `HUB_DATABASES="hub_test_p2qf hub_test_p2qf_boot hub_e2e_p2qf" bash scripts/dev/pg-init-roles.sh`
  and `HUB_DATABASES="hub_test_p2qf_probe" …` (the probe runs, so they never reset the database of a running suite).
- E2E stack configured like the CI e2e job (`.github/workflows/transformation-hub-ci.yml`, job `e2e`): `node deploy/docker/api-entrypoint.cjs migrate`,
  `node apps/api/dist/cli/seed-demo.js`, API `dist/main.js` on **:4872** with `HUB_RATE_LIMIT_PUBLIC_PER_MINUTE=1000`, worker `dist/worker.js`,
  production web build `env -u NODE_ENV HUB_API_URL=http://127.0.0.1:4872 pnpm --filter @hub/web run build`, `next start -p 3872`.
  The e2e database was reset (schema dropped, migrated, seeded) before each full Playwright suite, so both ran on a fresh demo
  seed; for run B the packages, API and web were rebuilt from the merged tree and the stack restarted.
- No Docker was started. Nothing started by others was touched. Logs in the session scratchpad (`…/scratchpad/logs/`).

## 2. Commands and real results

### 2.1 Unit, integration, register (at `8f8d72b`)

```
$ pnpm install --frozen-lockfile                      → Done in 3.4s
$ pnpm build:packages                                 → exit 0
$ (cd packages/domain && npx vitest run)              → Test Files 19 passed (19) · Tests 407 passed (407)
$ (cd packages/contracts && npx vitest run)           → Test Files 2 passed (2) · Tests 100 passed (100)
$ python3 scripts/requirements/apply_status.py --check → status-evidence.yaml OK (263 entries)
$ python3 scripts/requirements/apply_status.py        → applied 263 status updates; rendered 394 requirements; AT coverage 30/30
  git diff docs/requirements/ → empty (the register is in sync with status-evidence.yaml; nothing to restore)

$ TEST_DATABASE_URL=…/hub_test_p2qf TEST_DATABASE_MIGRATION_URL=…/hub_test_p2qf pnpm --filter @hub/api test      (run 1: the tree as frozen)
 Test Files  92 passed (92)
      Tests  802 passed | 4 expected fail (806)
   Duration  1267.83s
   (the 4 expected failures are the open P4 domain-review probes, `probe = it.fails` in reviews/p4-domain-*.spec.ts)
```

Run 2 of the full API suite with this review's added spec, and `pnpm lint`: §2.4.

### 2.2 Race and stale-state probes (this review; `apps/api/test/reviews/p2-qa-final-race.spec.ts` + the earlier `p2-qa-adversarial.spec.ts`)

Each repetition resets `hub_test_p2qf_probe` (global setup) and runs both files. `QA_RACE_RUNS=5` repeats every race five times
with fresh records inside one run; the per-user mutation rate limit was raised for these repetitions only
(`HUB_RATE_LIMIT_MUTATIONS_PER_MINUTE=5000 HUB_RATE_LIMIT_PER_MINUTE=10000`) because 5 × the races exceed the default 120
mutations per minute (at the default limit the first repetition failed with `429 rate_limited` in setup calls — not a product
finding). "Forced" = a test-only owner transaction holds `outbox_event` in SHARE ROW EXCLUSIVE mode until the racing requests
wait (at most 6 s), then releases it.

```
$ for i in 1 2 3; do QA_RACE_RUNS=5 HUB_RATE_LIMIT_MUTATIONS_PER_MINUTE=5000 HUB_RATE_LIMIT_PER_MINUTE=10000 TEST_DATABASE_URL=…/hub_test_p2qf_probe \
    TEST_DATABASE_MIGRATION_URL=…/hub_test_p2qf_probe npx vitest run test/reviews/p2-qa-final-race.spec.ts test/reviews/p2-qa-adversarial.spec.ts; done
  rep 1: Test Files 2 passed (2) · Tests 19 passed | 1 expected fail (20)
  rep 2: Test Files 2 passed (2) · Tests 19 passed | 1 expected fail (20)
  rep 3: Test Files 2 passed (2) · Tests 19 passed | 1 expected fail (20)
```

Printed evidence (3 repetitions × 5 runs; codes as returned by the API):

| Probe | Result over all runs |
|---|---|
| QA-P2-01 forced: decision raised for change X (1,500,000 SAR, externally approved); X and Y (1,200,000 each, cost confirmed) approved at the same instant on it | **15/15**: X `201 approved`, Y `422` — 12× `change_control.decision_already_used` (Y waited on the decision row lock, `waiting 2`, then saw X's registered use), 3× `change_control.decision_other_subject` (Y ran first, `waiting 1`). Exactly one approved change request and one `decision_use` row per decision |
| QA-P2-01 plain parallel: four change requests approved at once on the decision raised for one of them | **15/15**: exactly one `201` (the subject), three `422` (`decision_already_used` / `decision_other_subject`), no 5xx |
| Same change request approved three times at once on its decision (plain ×5 + forced ×1 per repetition) | **18/18**: `[201, 409, 409]` (`concurrency.version_mismatch`), one success audit row, one `decision_use` row |
| Change request + baseline on ONE decision at the same time (plain ×5 + forced ×1) | **18/18**: change `201`, baseline `422 change_control.decision_type_mismatch`, baseline stays `proposed` with no decision, one `decision_use` (kind `change_request`) |
| Perimeter version + G1 gate cycle on ONE G1 decision (forced; plus a duplicate decide) | **3/3**: perimeter version `201`, gate `[201, 409]`; two `decision_use` rows (`perimeter_version`, `gate_cycle`) — the documented rule "one record of EACH kind" (see O-F2) |
| QA-P2-03: relied-upon evidence verified after submission → decide | **3/3** `422 gates.assessment.review_stale`, cycle stays `ready_for_decision`, no use registered; after back-to-assessment + fresh endorsement + submission the SAME decision approves (`201`) |
| QA-P2-03 original probe (late evidence after submission) | **3/3** `decide 422 gates.assessment.review_stale` |
| F-03: five agenda requests screened onto one meeting at once | **15/15** meetings numbered `[1,2,3,4,5]`, all `201`; original probe `[1,2,3]` 3/3 |
| QA-P2-01 original probe (decision raised for NO record) | 3/3 `[422, 422]` `change_control.decision_no_subject`, `waiting 0` — passes, but no longer exercises the race (QA-P2F-01) |
| QA-P2F-02 (`it.fails`): an approval blocked longer than the 10 s `lock_timeout` | 3/3 `500 internal_error`; the change stays `under_review` |

A first repetition before two harness corrections (single run each, `QA_RACE_RUNS=3`, default rate limit) also passed the
QA-P2-03, same-CR, CR+baseline, perimeter+gate and F-03 probes; its two X/Y probes failed only on this review's own expectation
(it required `decision_other_subject`, the server answered `decision_already_used` — both are documented refusals; the
expectation was widened to either code, and "exactly one approved" and "no 5xx" were kept). In a later repetition the forced
lock was held ~10 s and the waiting approval failed with `500` at the API's `lock_timeout` — the harness now holds the lock at
most 6 s, and the 500 itself is recorded as QA-P2F-02.

### 2.3 End-to-end (Playwright) — the exit criterion in the UI (this review; `e2e/tests/qa-p2-final-authority-ui.spec.ts`)

At `8f8d72b`: run on its own first (debugging on the e2e database, which was then reset; the output below is the last of these
runs), then as part of the full suites (§2.4, run A at `8f8d72b`, run B at `9b8d59f` — both passed, same axe results).

```
$ HUB_WEB_URL=http://127.0.0.1:3872 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm --filter @hub/e2e exec playwright test tests/qa-p2-final-authority-ui.spec.ts
  ✓ 1 … subject, paper evidence, conflict declaration, chair closing the vote, assessor-confirmed cost — refused paths and the authorized approval (1.6m)
  ✘ 2 … QA-P2F-03: the history entry of the chair closing the vote is a translated label, not a raw audit code (en and ar)   [expected failure, test.fail]
  2 passed (2.0m)
  record-outcome while votes are outstanding (API): 422 governance.outcome.votes_outstanding
  close-voting by the secretary (API): 403 governance.voting.not_chair
  approval of the other change on the used decision: 422 change_control.decision_already_used
  tally snapshot after the chair closed voting: {…"voting":{"closedBy":…,"complete":"closed_by_chair","notVoted":[<legal>,<approver>],"closeReason":"Synthetic QA: the two remaining members left the session"}…}
  [QA-P2F-03 en] close-voting history entry: … Demo Committee Chair — governance.decision.close_voting
  axe (WCAG 2.0/2.1 A+AA, serious/critical gating) on every open dialog — 0 violations each:
    paper dialog raised from the change request (ar 14 rules passed; en 14) · vote dialog with the conflict step (en 17; ar 17) ·
    record-outcome dialog while votes are outstanding (en 17) · close-voting dialog (ar 17; en 17) ·
    change approval dialog with the decision picker (ar 16; en 17) · change assessment dialog (ar 14; en 14)
```

### 2.4 Full suites with this review's files; lint

**Run A — `8f8d72b` + this review's test files** (commit `93ce832`; stack as in §1, e2e database reset and freshly seeded):

```
$ pnpm lint                                   → exit 0
  apps/api: module boundary check passed: 35 cross-module imports, 16 module edges, acyclic, only published surfaces
  apps/web: i18n check passed: 19 namespaces, 6482 keys per language, 611 enum values, 86 server message codes, 27 AI refusal codes
            Hard-coded UI string check passed (self-test: 6 fixture violations detected)
$ HUB_WEB_URL=http://127.0.0.1:3872 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm --filter @hub/e2e exec playwright test
  Running 314 tests using 1 worker
  314 passed (28.8m)
  ✘ (expected, test.fail) qa-p2-arabic-rtl.spec.ts:121 "PM (known English remainders, QA-P2-04) …"
  ✘ (expected, test.fail) qa-p2-final-authority-ui.spec.ts:443 "QA-P2F-03 …"
  ✓ qa-p2-final-authority-ui.spec.ts:127 (the exit-criterion journey) · all p2-*, qa-p2-*, p3-*, p4-*, p5-* specs passed
  a11y (docs/test-evidence/a11y-report.md regenerated by the run, then restored): Scans 240 (120 screen states × 2 locales) —
  Gating result (serious/critical WCAG violations): PASS — 0
```
The full API suite at `8f8d72b` (run 1, §2.1) did not yet contain `p2-qa-final-race.spec.ts`; that file ran on its own in §2.2.

**Run B — `9b8d59f` = `88f1a88` (QA-P2-04 fix) + this review's test files** (packages, API and the production web rebuilt from
the merged tree — `HUB_API_URL` fixed at build time; the e2e database dropped, migrated with the regenerated migration and
seeded; API, worker and web restarted):

```
$ pnpm install --frozen-lockfile && pnpm build:packages && pnpm --filter @hub/api run build   → exit 0
$ env -u NODE_ENV HUB_API_URL=http://127.0.0.1:4872 pnpm --filter @hub/web run build           → exit 0
$ (cd packages/domain && npx vitest run)      → Test Files 20 passed (20) · Tests 414 passed (414)
$ (cd packages/contracts && npx vitest run)   → Test Files 2 passed (2) · Tests 100 passed (100)
$ python3 scripts/requirements/apply_status.py --check → status-evidence.yaml OK (263 entries)
$ pnpm lint                                   → exit 0
  apps/web: i18n check passed: 19 namespaces, 6599 keys per language, 611 enum values, 150 server message codes (gates incl.
            JV, finance, planning, governance), 27 AI refusal codes, 50 gate refusal codes; hard-coded string check passed
$ HUB_WEB_URL=http://127.0.0.1:3872 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm --filter @hub/e2e exec playwright test
  Running 314 tests using 1 worker
  314 passed (27.8m)
  ✓ qa-p2-arabic-rtl.spec.ts:120 "PM (formerly known English remainders, QA-P2-04) …" — now a strict test, passed
  ✘ (expected, test.fail) qa-p2-final-authority-ui.spec.ts:443 "QA-P2F-03 …" (the only ✘)
  ✓ qa-p2-final-authority-ui.spec.ts:127 (the exit-criterion journey; same 11 dialog scans, 0 violations each;
    Arabic decision and change pages: 0 detector problems)
  ✓ qa-p2-gate-review-journey: "markReady refused; translated explanation shown: true" (×2; it printed false at 1b30f48)
  a11y: Scans 240 — Gating result (serious/critical WCAG violations): PASS — 0
$ TEST_DATABASE_URL=…/hub_test_p2qf TEST_DATABASE_MIGRATION_URL=…/hub_test_p2qf pnpm --filter @hub/api test      (run 2)
 Test Files  1 failed | 93 passed (94)
      Tests  1 failed | 815 passed | 5 expected fail (821)
   Duration  1048.03s
   FAIL reviews/p2-qa-final-race.spec.ts > F-03 re-check … : 429 rate_limited ("expected 429 to be 201")
   (5 expected failures: the 4 open P4 domain-review probes and this review's QA-P2F-02 probe)
```
The only failure was this review's own F-03 check: the races before it in the same file had used the PM's and the secretary's
per-minute mutation budget (`HUB_RATE_LIMIT_MUTATIONS_PER_MINUTE`, default 120), so the API answered 429 — a harness problem of
the new file, not a product defect (the same check passed 15/15 with the limit raised, §2.2). Fix in `e2bce79`: the F-03 check
runs first and each race runs once by default (`QA_RACE_RUNS` for repetitions); no assertion changed. Then, at `e2bce79`
(= `9b8d59f` + that fix):

```
$ (cd apps/api && TEST_DATABASE_URL=…/hub_test_p2qf_probe … npx vitest run test/reviews/p2-qa-final-race.spec.ts test/reviews/p2-qa-adversarial.spec.ts)   ×2, default limits
  run 1: Test Files 2 passed (2) · Tests 19 passed | 1 expected fail (20) — F-03 [1,2,3,4,5] / [1,2,3]; QA-P2F-02 500
  run 2: Test Files 2 passed (2) · Tests 19 passed | 1 expected fail (20)
$ TEST_DATABASE_URL=…/hub_test_p2qf TEST_DATABASE_MIGRATION_URL=…/hub_test_p2qf pnpm --filter @hub/api test      (run 3)
 Test Files  94 passed (94)
      Tests  816 passed | 5 expected fail (821)
   Duration  929.40s
   (5 expected failures: the 4 open P4 domain-review probes and QA-P2F-02; includes the QA-P2-04 fix's
    planning/qa-p2-04-bilingual.spec.ts and this review's p2-qa-final-race.spec.ts)
```
After each e2e run the tracked screenshots and `docs/test-evidence/` rewritten by the suite were restored with `git checkout`;
only the screenshots of this review's own spec (`e2e/screenshots/qa-p2-final/`, from run B) are kept.

### 2.5 CI (public GitHub REST API, read-only, no credentials; no `gh`)

```
GET https://api.github.com/repos/ghanemn94-rgb/My-owns/actions/runs?head_sha=8f8d72b03db1d539987517d67b2a063a104d4a67 → 200, total_count 1
GET …/actions/runs/36758100924 → run_number 45, head_sha 8f8d72b0…, event push, status completed, conclusion success,
    created 2026-09-30T18:22:24Z, updated 18:42:52Z
GET …/actions/runs/36758100924/jobs → 14 jobs, all completed / success: Install, build packages, typecheck, lint · Domain/contract
    unit tests + template validator · API integration tests (PostgreSQL 16) · Web build + private-mode egress check (AT-22) ·
    Container images (build only) + image SBOM + vulnerability report · OpenAPI generation · Licence policy · pnpm audit --prod ·
    Source SBOM · Helm / kubeconform / compose / shellcheck · Backup/restore drill (AT-23) · Docker Compose dev/eval stack ·
    Playwright smoke (demo stack) · Secret scan (gitleaks — history + tree, web bundle, CI test reports)
Earlier: run 44 (d0fb4bf, which already contains the P2 fixes) success; runs 42/43 (f8fdf01, 1538222) cancelled.

GET …/actions/runs?head_sha=88f1a88c207c23352e4c90bd99a478343a08f1da → run 46 (id 36763068604), push, completed / success,
    created 19:04:13Z, updated 19:28:10Z; …/runs/36763068604/jobs → 14 jobs, all completed / success
```
Job logs were not downloaded.

## 3. Per-finding status (P2 QA review)

| ID | Severity | Implementer's status | Re-verified here | Result |
|---|---|---|---|---|
| QA-P2-01 | High | Fixed (decision-use registry, row lock, unique backstops; subject binding DOM-P2R-03) | §2.2: 15/15 forced, 15/15 four-way parallel, 18/18 same-CR, 18/18 CR+baseline, 3/3 perimeter+gate; never two approvals on one decision, never 5xx within the lock timeout; one `decision_use` per decision and kind. UI: the other change's picker does not offer the decision, API `422 decision_other_subject`, after use `422 decision_already_used` (§2.3) | **Closed** |
| QA-P2-03 | Low | Fixed (`decide` re-checks the endorsement basis) | §2.2: 6/6 `422 gates.assessment.review_stale` (late evidence, and verification after submission); a refused attempt consumes nothing; a fresh review lets the same decision approve | **Closed** |
| F-03 | Low | Fixed (meeting row lock + `agenda_item_number_uq`) | §2.2: 15/15 five-way screenings numbered 1..5; original probe 3/3 | **Closed** |
| O-1 | Obs. | Fixed — PROPOSED rule, pending the governance owner | Rule: a decision linked to ANY earlier cycle of a gate (approved or rejected) cannot back a later cycle (`gates.decide.decision_reused`); the rejected cycle's reliance is registered (`gate_cycle`). Test `gates/p2r-gate-decision-evidence.spec.ts` "O-1 …" green in the full run; documented in `docs/governance/business-gates.md` (rule, line 330) and `assumptions-and-open-questions.md` A-52 with the open question to the governance owner | **Implemented as proposed**; governance-owner confirmation is a condition |
| QA-P2-02 (C1) | Medium | — | §4 C1 | **Open** (4 of 23 closed) |
| QA-P2-04 (C5) | Medium | Fixed (`a848f6c`, merged at `88f1a88`) | At `8f8d72b`: not merged, the `test.fail` still fails as expected. At `9b8d59f`: the former `test.fail` is a strict test and passes in the full run (detector unchanged: `qa-rtl-detector.ts` has no diff); the formerly English screens inspected as PNGs (§4 C5) | **Open at `8f8d72b`; closed at `88f1a88`** |
| QA-P2-05 | Low | Duplicate claim ids refused (`40fac20`) | Validator: duplicate check present (`validate-templates.mjs:254-256`). Boundary checker probes on scratch copies: template-literal import now **refused** (exit 1); re-export laundered through `src/platform/` and a `.js` file in a module still **pass** (exit 0) | **Partly closed** (Low residual) |
| QA-P2-06 (C4) | Low | Refreshed (`40fac20`, `1538222`) | §4 C4 | **Partly closed** |
| QA-P2-07 (C3) | Info | — | CI run 45 at `8f8d72b` green in 14/14 jobs (§2.5) | **Closed for `8f8d72b`** |

## 4. Conditions C1–C5

### C1 — the 23 P2 musts "close before the P2 gate" (QA-P2-02) — **NOT MET**

Register at `8f8d72b` (computed from `docs/requirements/requirements.yaml` with a scratch script; the register is in sync with
`status-evidence.yaml`, §2.1): P2 musts 85 = **Tested 60 · Implemented 23 · Deferred 2** (was 56 / 27 / 2 at `1b30f48`).

Of the 23: **closed (now Tested)** — REQ-GOV-013 (F-03), REQ-GOV-014 (DOM-P2-14), REQ-GOV-015 (F-01), REQ-UX-005 (cockpit tiles).
**Still Implemented (19)** — none carries a target phase, owner and reason in the register or in
`docs/phases/P2-P4-requirement-disposition.md` (its "Updates after this disposition" section does not mention them; every one
keeps `phase: P2` and a "gap: …" evidence line):

| Group | Requirements | Status |
|---|---|---|
| "Close before P2 gate" (11) | GOV-002, GOV-019, GOV-027, PLN-002, UX-006, UX-008, UX-009, UX-015, UX-023, UX-024, DAT-013 | gap — neither closed nor re-phased |
| "Close or re-phase / accept" (8) | SET-013, SET-014, GOV-008, GOV-009, GOV-012, WS-003, UX-018, UX-022 | gap — neither closed nor re-phased |

Other P2 musts not Tested (outside the 23, already dispositioned): ENT-010 (variance O-2, accepted), PLN-023 (AI part re-phased
to P5), PLT-008 and PLN-019 (Deferred to P6), UX-007 (evidence still says "AT-04 in the UI is shown only as the Recommended
metric" — AT-04 in the UI is now executed by `p2-web-followups.spec.ts` (a) and this review's e2e spec; candidate for Tested),
PHS-004 (closes with the gate report).

**Required for the gate report:** for each of the 19, either the test of its AT, or an explicit re-phase with target phase,
owner and reason (the QA-P1R-02 precedent), and the disposition document updated accordingly.

### C2 — independent reviews — **PARTLY MET**

- P2 security review: `docs/reviews/P2-security-review.md` at `1b30f48`, **PASS WITH CONDITIONS** (SEC-P2-01/-02 Medium). Its
  probe spec `reviews/p2-sec-probes.spec.ts` passes in the full run. The implementer marked all its findings fixed (`4803eb1`,
  `30ded28`) and changed the reviewer's probes to assert the fixed behaviour; for SEC-P2-02 the assertion itself changed
  (the fix option "only the requester writes and submits the paper" replaced "a member who rewrote the paper cannot vote").
  No independent security re-check of those fixes is recorded (O-F1).
- P2 domain re-review: `docs/reviews/P2-domain-rereview.md` at `1b30f48`, **FAIL** (DOM-P2R-03/-04 High, DOM-P2R-05 High P3),
  with an implementer's fix status; its probes (changed by the implementer to their fixed form) pass in the full run.
- The **final focused domain review** is running in parallel (per the lead); it is not in the tree at `8f8d72b` — NOT VERIFIED
  here. The gate needs its verdict (no open High).

### C3 — CI — **MET for `8f8d72b` and `88f1a88`**

Run 45 (id 36758100924) on `8f8d72b` and run 46 (id 36763068604) on `88f1a88`: completed / success, 14/14 jobs success each
(§2.5). The P2 gate report must cite a green run on the gate revision itself (later than `88f1a88` once this review merges).

### C4 — documents current — **PARTLY MET**

Current: `status-evidence.yaml` validates and matches the register; the stale P2 web-follow-up entries of QA-P2-06 were refreshed;
`module-guide.md` ("Relying on a governance decision"), `business-gates.md` (O-1 rule), `assumptions-and-open-questions.md`
(A-50, A-52, A-53, Q-40) describe the new rules. Still stale at `8f8d72b`:

- `docs/DELIVERY_STATUS.md` — "Last updated … at revision `5b2a3bc` (API suite 721/721 …)", domain "348 unit tests", "Web: the
  external-approval dialog fails with 422 until the P2 web follow-ups merge", "Cross-project dependencies and prerequisites: API
  Tested, web screens In progress". Actual here: 407 domain tests, 802 + 4 expected-fail API tests, the dialog and screens work.
- `docs/WORK_LOG.md` — "Checkpoint revision: `e75f7fd`" (the text below it was refreshed in `1538222`); "Verified: API 748 + 11
  expected fail at `1c6b375`"; "Open P2 gaps … DOM-P2-14; GOV-013, GOV-015 …; UX-005" (now closed).
- `status-evidence.yaml` REQ-PHS-004: "open: DOM-P2-14 and DOM-P2-16 (Low); domain re-review and QA review not run" (both reviews
  ran; both findings fixed). REQ-UX-007: see C1.
- `docs/phases/P2-P4-requirement-disposition.md` §4 still lists GOV-013/-014/-015, UX-005, F-13 as open work; the 23-must
  disposition is not updated (C1).

### C5 — QA-P2-04 (English remainders on P2 screens in Arabic) — **open at `8f8d72b`; MET at `88f1a88`**

- At `8f8d72b` (run A): not merged; `qa-p2-arabic-rtl.spec.ts` test 1 still failed as expected (`test.fail`), and this review's
  Arabic decision page showed the server's English authority reason ("Amount exceeds the committee delegated limit.").
- At `9b8d59f` = `88f1a88` + this review's tests (run B): test 1 is a strict test and **passed** in the full suite; the shared
  detector `qa-rtl-detector.ts` is unchanged (no diff since this reviewer wrote it); the only elements newly marked
  `data-user-text` (skipped by the detector) are decision titles, which are free text typed by the requester. This review's
  journey shows the authority reason in Arabic ("المبلغ يتجاوز الحد المفوَّض للجنة.") and 0 detector problems on the Arabic
  decision and change pages.
- **Inspected PNGs at `9b8d59f`** (`e2e/screenshots/qa-p2/`, opened and read; restored afterwards as tracked files):
  `ar-p2-task-detail` — description, output, acceptance criteria, effort ("مفترض — أيام عمل الأفراد: 8"), evidence type
  ("مستند معتمد"), duration basis ("مفترضة") and the dependency titles are Arabic; "CPMO" (template value without Arabic) remains,
  as the fix status lists; the dependency column still wraps word by word (cosmetic, noted in the first review).
  `ar-p2-plan-health` — workstream names, red-critical card, RAG explanations, data-quality issues ("لم يُسجَّل أي تحديث مقبول")
  and the schedule-gap line are Arabic; the RAG override row shows the demo seed's English reason and persona (data).
  `ar-p2-plan-timeline` — schedule gaps and the assumptions disclosure in Arabic. `ar-p2-my-work` — template task titles and the
  status-update title in Arabic; English only for the demo action and change-request titles and this review's synthetic change
  (free text). `ar-p2-decision-recommended` — the authority reason is Arabic with the DEMO-policy body name "Board of Directors —
  to be confirmed" (data); the demo paper text and vote comments are demo-seed English (data).
- Remaining English listed by the fix (user / demo text, DEMO-policy names, template values without Arabic, the server's
  refusal detail under the translated explanation — QA-P1R-05, escalation titles composed in English) is consistent with what
  was seen. The escalation-title remainder should be carried with an owner in the gate report.

## 5. Exit criterion "block decisions outside authority" — end to end in the UI, English and Arabic

`e2e/tests/qa-p2-final-authority-ui.spec.ts` (DEMO-DC; every asserted behaviour goes through the UI; each rule is also tried
through the API without the UI; fixtures only for agenda/meeting logistics and the external body's approval):

| Rule | UI (English) | Arabic (RTL) | Bypass through the API |
|---|---|---|---|
| Decision subject (DOM-P2R-03) | "Raise decision paper" on the change request opens the paper with the subject pre-selected (type change request, record = this change); the decision shows "Authorizes: Change request — <title>"; the approval dialog of ANOTHER change offers no decision (`approval-decision-empty`); the dialog of the subject change lists it | paper dialog raised from the change: detector clean, axe 0; approval dialog with the decision picker: detector clean, axe 0 | other change on the decision → `422 change_control.decision_other_subject`; after use → `422 change_control.decision_already_used` |
| Paper evidence or "none" reason (DOM-P2-14) | saved without either: "Complete these fields: Supporting evidence or attachment — or "none" with a reason"; Submit → refusal `governance.decision.incomplete_paper`, translated ("The paper is incomplete. …"), status stays Draft; an evidence link on the paper → "The paper is complete and can be submitted." → Submitted | incomplete-paper panel: detector clean | submit → `422 governance.decision.incomplete_paper` |
| Conflict declaration before voting (REQ-GOV-015, A-50) | Vote disabled until the member declares; chair declares "no conflict" and votes; Finance declares a conflict → reason required → recusal recorded instead of a vote | sponsor's vote dialog: conflict step in Arabic, Vote (تصويت) disabled until declared, then voted; detector clean, axe 0 | vote without the member's own declaration → `422 governance.vote.declaration_required` |
| Chair closes the vote (DOM-P2R-01, Q-40) | with two present members not voted: "Record outcome" disabled, "Not yet: 2 eligible member(s) have not voted."; the secretary is not offered "Close voting"; the chair's dialog shows "Members who have not voted yet: 2", refuses an empty reason ("This field is required."), closes with a reason; Legal is no longer offered Vote; the chair records the outcome → Recommended (2 approve · 0 reject · 0 abstain) | close-voting dialog: detector clean, axe 0 | record-outcome before → `422 governance.outcome.votes_outstanding`; close by the secretary → `403 governance.voting.not_chair`; no reason → `400`; late vote → `422 governance.vote.voting_closed`; the tally snapshot lists both non-voters (`notVoted`) and `complete: closed_by_chair` |
| Cost impact confirmed by the assessor (DOM-P2R-02, Q-43) | the requester's 1,500,000 SAR shows "not confirmed"; the sponsor's approval on the (externally approved, subject-matching) decision → refusal `change_control.amount_unconfirmed` translated ("… stated by the requester only …"); Legal (assessor, not the requester) records the assessment → "confirmed"; the sponsor approves on the decision → Approved, linked to the decision | assessment dialog: detector clean, axe 0; approved change page: detector clean | the requester re-recording the amount does not confirm it (`costImpactConfirmed` stays false) |

Dialog accessibility (every dialog above, both languages where shown): role dialog with an accessible name, focus inside,
Escape closes (Arabic inspections), axe WCAG 2.0/2.1 A + AA — **0 violations** (not only 0 serious/critical) in all 11 scans.
No console or page errors for any of the six personas.

**Inspected PNGs** (`e2e/screenshots/qa-p2-final/`, opened and read; the dialogs at `8f8d72b`, the decision page at both
revisions; the committed files are those of run B at `9b8d59f`): `ar-final-vote-dialog-conflict-step` (title, effects,
conflict legend and both options, info note, vote choices, comment, buttons in Arabic; RTL alignment correct; the decision code
is LTR); `ar-final-close-voting-dialog` (Arabic; "الأعضاء الذين لم يصوّتوا بعد: 2"; required reason marked); `ar-final-paper-dialog-from-change`
(subject fieldset in Arabic with "طلب تغيير" and the change's user-entered title; committee option shows the demo committee's English
name next to the Arabic kind — data); `ar-final-change-approval-dialog-decision` (Arabic; the picker shows the user-entered decision
title; badges معتمد / بانتظار جهة اعتماد خارجية; amount "1,500,000 SAR"); `ar-final-change-assess-dialog` (Arabic labels; the
requester's text is user data); `ar-final-decision-recommended` (Arabic throughout except user data, persona names and the
DEMO-policy body; at `8f8d72b` the authority reason was English — QA-P2-04 — and at `9b8d59f` it is Arabic; at both revisions
the history entry **`governance.decision.close_voting`** is shown as a raw code — QA-P2F-03).

**Result: Met** at `8f8d72b` and at `9b8d59f` — the five rules block decisions outside authority in the UI and through the API,
in English and Arabic.

## 6. New findings

| ID | Severity | Summary | Status |
|---|---|---|---|
| QA-P2F-01 | Low | The QA-P2-01 probe of the first review passes vacuously since DOM-P2R-03 (both approvals refused `decision_no_subject` before the single-use check); the fix status cites it as proof of the race fix | Closed by this review: probe annotated; the race is exercised by `p2-qa-final-race.spec.ts` |
| QA-P2F-02 | Low | A request that waits longer than `lock_timeout` (10 s) or `statement_timeout` gets `500 internal_error`: `platform/errors.ts` `fromPg` maps 23505/23503/23514/42501/22P02/P0001/40001/40P01 but not 55P03 or 57014 | Open — `it.fails` probe |
| QA-P2F-03 | Low | The audit action `governance.decision.close_voting` (DOM-P2R-01) has no `governance.audit.decision_close_voting` label in en or ar: the decision history shows the raw code in both languages; the i18n lint cannot see dynamic audit codes. Checked against the database of the full API run: of the 47 distinct `governance.*` actions recorded with outcome `success`, this is the only one without a label (refused attempts carry no entity id and are not listed in the history) | Open — `test.fail` |

### QA-P2F-01 — Low — the original QA-P2-01 probe no longer exercises the race

- **Where:** `apps/api/test/reviews/p2-qa-adversarial.spec.ts` "two change requests above the delegated limit approved at the same
  time on ONE final decision". Since DOM-P2R-03 an approval needs a decision raised FOR that change request; the probe's decision
  is raised for no record.
- **Evidence:** 3/3 repetitions print `approve statuses [422,422] codes ["change_control.decision_no_subject", …]`, `waiting 0`.
  The assertion "at most one approved" holds trivially. `P2-qa-review.md` "Fix status" states the three `.fails` probes "were turned
  into plain tests and pass".
- **Resolution (this review):** comment added to the probe; `p2-qa-final-race.spec.ts` uses decisions raised for a record, so the
  approval that can pass does pass, and shows the lock (`waiting 2` → `decision_already_used`).

### QA-P2F-02 — Low — lock or statement timeouts are answered 500

- **Reproduction:** `p2-qa-final-race.spec.ts` "QA-P2F-02 …" (`it.fails`): an owner transaction holds `outbox_event` for 11.5 s
  while the sponsor approves a change → `500 internal_error` (3/3); nothing is applied (`under_review`). Also seen unintentionally
  when the forced-interleaving harness held its lock for ~10 s.
- **Impact:** under real contention (a long report, a migration, a stuck transaction) users see "internal error" instead of a
  retryable conflict; alerting counts it as a server fault. No integrity impact (the transaction rolls back).
- **Recommendation:** map 55P03 (`lock_not_available`) and 57014 (`query_canceled`) to a retryable problem (409 `db.lock_timeout`
  or 503 with `Retry-After`), then drop `.fails`.

### QA-P2F-03 — Low — "Close voting" appears as a raw audit code in the decision history

- **Reproduction:** `qa-p2-final-authority-ui.spec.ts` test 2 (`test.fail`): after the chair closes voting, the history entry reads
  "… Demo Committee Chair — governance.decision.close_voting" in English; the Arabic page shows the same `<code>` (detector listing
  and `ar-final-decision-recommended.png`). `gov.tsx` `GovHistory` falls back to the code when `governance.audit.<action>` is missing.
- **Recommendation:** add `decision_close_voting` to `apps/web/src/i18n/messages/{en,ar}/governance.json` → `audit`, and a lint or
  unit check that every `governance.*` audit action emitted by the API has a label; then make test 2 a plain test.

### Observations (no severity)

- **O-F1 — reviewer probes changed by the implementer.** The SEC-P2-02 probe's assertion changed with the fix option (see C2), and
  the domain re-review probes were edited into their fixed form (`p2-domain-rereview.spec.ts` +45/−19). They pass; whether they
  still test what each reviewer required is for the security reviewer and the final domain review to confirm.
- **O-F2 — one G1 decision backs the G1 gate cycle AND one perimeter version.** Verified under concurrency (§2.2). It matches the
  documented rule ("one record of EACH kind", `packages/domain/src/decision-reliance.ts`; A-52 asks the governance owner whether
  one decision may authorize several records explicitly). Not a defect; part of the governance-owner confirmation.
- **O-F3 — proposed rules pending the governance owner.** O-1 (rejected cycles consume their decision), A-50 (declarations before
  voting), Q-40 / DOM-P2R-01 (vote closure by the chair; non-voters not counted), Q-43 (assessor-confirmed cost), A-53.
  They are implemented and tested as proposals; the gate report should list them as open decisions of the governance owner.

## 7. Files written by this review

- This report: `docs/reviews/P2-qa-final-review.md`.
- API: `apps/api/test/reviews/p2-qa-final-race.spec.ts` (8 tests: 7 plain, 1 `it.fails` linked to QA-P2F-02); a comment in
  `apps/api/test/reviews/p2-qa-adversarial.spec.ts` (QA-P2F-01; no assertion changed).
- E2E: `e2e/tests/qa-p2-final-authority-ui.spec.ts` (2 tests: the journey, and a `test.fail` linked to QA-P2F-03);
  screenshots `e2e/screenshots/qa-p2-final/*.png` (the PNGs listed in §5, from run B).
- Commits on the review branch: `93ce832` (the test files, as run at `8f8d72b`), `9b8d59f` (merge of `88f1a88`, no conflict),
  `e2bce79` (race spec within the default rate limit; screenshots from run B), then this report.
- Not committed (scratchpad): run logs, the P2-must and audit-label comparison scripts, the boundary-checker probe script, the
  e2e stack scripts.
- Cleanup: the API, worker and web server of each stack (run A: PIDs 17891, 17892, 17996 and the restarted 24924, 24925; run B:
  17410, 17411, 17475) were stopped by PID after checking their command lines and working directories; ports 4872 / 3872 are
  free. Tracked screenshots and `docs/test-evidence/` rewritten by the e2e runs were restored with `git checkout`. The review
  databases (`hub_test_p2qf`, `hub_test_p2qf_boot`, `hub_test_p2qf_probe`, `hub_e2e_p2qf`) are left in place (test data only).

## 8. Verdict

**PASS WITH CONDITIONS** — at `8f8d72b` (with C5 open) and at `9b8d59f` = `88f1a88` + this review's tests (C5 met).

- No open Critical or High in the QA scope: QA-P2-01 is fixed and verified under forced and plain concurrency, across change
  requests, the same change request, a change request with a baseline, and a perimeter version with a gate cycle.
- The required verification was executed: full API suite (§2.1 run 1 at `8f8d72b`: green; §2.4 run 2 at `9b8d59f`: one failure
  of this review's own harness, fixed; run 3 at `e2bce79`: 94/94 files green), full Playwright suite on
  a fresh seed at both revisions (§2.4 runs A and B), the race probes repeated (§2.2), the exit criterion end to end in the UI in
  English and Arabic with axe on every dialog (§2.3, §5), CI checked on both revisions (§2.5).
- **Conditions for the P2 gate report:**
  1. **C1** — the 19 remaining P2 musts: test or re-phase each with phase, owner and reason; update the disposition document.
  2. **C2** — the final focused domain review must report no open High; the security reviewer (or the gate reviewer) confirms the
     implementer-adapted SEC-P2-02 probe (O-F1).
  3. **C3** — met for `8f8d72b` (run 45) and `88f1a88` (run 46); cite a green CI run on the gate revision itself.
  4. **C4** — refresh `DELIVERY_STATUS.md`, the `WORK_LOG.md` checkpoint, REQ-PHS-004 / REQ-UX-007 evidence and the disposition §4.
  5. **C5** — met at `88f1a88`; the gate revision must include it. Carry the remainders the fix lists (escalation titles composed
     in English, template values without Arabic, the server's refusal detail — QA-P1R-05) with owners.
  6. Governance-owner decisions on the proposed rules (O-F3), recorded in the gate report.
  7. Low items with owners: QA-P2F-02 (platform errors), QA-P2F-03 (web i18n + lint), QA-P2-05 residual (boundary checker).

## 9. NOT EXECUTED

- **CI on this review's branch**: not triggered (no push to the integration branch). Job logs of runs 45 and 46 were not
  downloaded.
- **The race probes (§2.2) with 5 repetitions at the merged revision**: repeated (3 × 5) only at `8f8d72b`; at `9b8d59f` /
  `e2bce79` they ran with the default single repetition — twice on their own and inside the full API suite (runs 2 and 3). The QA-P2-04 fix does not touch the decision-reliance, change-control, perimeter or
  meetings services; in the domain it changes `checkAuthority` to build its reason from message codes with the same outcomes
  (diff read), plus planning health / schedule / WBS / My Work texts, gate names and the decision's authority-reason codes.
- **Docker / Compose / Helm / image builds**: no Docker daemon; not started.
- **The final focused domain review and a security re-check**: other reviewers' scope (C2).
- **Manual screen-reader, zoom and high-contrast checks**: not done; accessibility evidence is axe plus the dialog behaviour
  checks (accessible name, focus, Escape).
- **Gate decisions in the UI on a final decision (approve)** beyond what the existing e2e specs cover: the gate part of the
  criterion was re-verified through the API (QA-P2-03, O-1, perimeter + gate) only.

---

## Fix status (lead, after this review)

The reviewer's text above is unchanged.

| Finding / condition | Status | Evidence |
|---|---|---|
| QA-P2F-02 (Low) | **Fixed.** `platform/errors.ts` maps PostgreSQL 55P03 `lock_not_available` to 409 `db.lock_timeout` and 57014 `query_canceled` (statement timeout) to 503 `db.statement_timeout`; both are retryable and nothing is applied. | The probe is now a plain test "QA-P2F-02 (fixed, regression): …" with its assertion unchanged, and passes. The 57014 branch has no executed test of its own; it is a direct mapping. |
| QA-P2F-03 (Low) | **Fixed.** The label `governance.audit.decision_close_voting` was added in en and ar. The i18n check (`apps/web/scripts/check-i18n.mjs` §8) now requires a history label for every literal governance and finance audit action (52 today). Negative check: removing the label fails the check with both locales named. | The e2e `test.fail` is now a plain test "QA-P2F-03 (fixed, regression): …". |
| QA-P2-05 residual (Low) | **Fixed.** The module boundary checker refuses a non-TypeScript source file inside a module, and any import of a module from `src/platform/`, so a module's internals can no longer be re-exported through the platform layer. | Probes on scratch files: a `.js` file in `modules/gates` and a platform re-export of `gates/gates.jobs` fail the check (exit 1, both named); the tree passes. |
| C1 | **Addressed.** All 23 P2 musts still Implemented have what is missing, an owner and a target. | `docs/phases/P2-P4-requirement-disposition.md`, "Update at the P2 gate". |
| C2 | **In the P3/P4 reviews.** The independent re-check of the adapted probes (SEC-P2-02; the domain re-review and final-review probes) is part of the P3/P4 security review and the P3 domain review. | Review briefs ("P2 closure re-check"). |
| C4 | **Met.** `DELIVERY_STATUS.md`, the `WORK_LOG.md` checkpoint, REQ-PHS-004 / REQ-UX-007 evidence and the disposition are refreshed. | This commit. |
