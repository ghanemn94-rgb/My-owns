# Handback T-DG5-FE-RG2 (frontend-ux-engineer): DG5 round-5 repair

- **Stage / gate:** P5, DG5 FIXING after re-gate round 2 on candidate `sha256:5df44203…` (D-184 to D-187).
- **Invocation:** run `DG5-T-DG5-FE-RG2-frontend-ux-engineer-20261024T185955Z-56a370f1`, session `56a370f1-200a-41fe-9819-884a237e5c26`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-FE-RG2.md`. I checked its sha256, `1b9f3ae9…bcb55f8c`, before starting.
- **Working tree:** `/home/user/wt/dg5-fe-rg2`, branch `dg5/fe-rg2`, base `HEAD` 365ee09. The changes are left **uncommitted**, as instructed.
- **Time:** started 2026-10-24T19:00:07Z, ended 19:30:46Z (`date -u`). That is about 31 minutes, well inside the limit.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` exited 0 at the start (`PASS gate DG4 (historical)`, `T-DG5-FE-RG2-evidence/00-validate-dg4-start.log`) and at the end (`99-validate-dg4-end.log`).

## Files changed

| File | Purpose |
|---|---|
| `apps/web/e2e/p3-prioritization-roadmap.spec.ts` | F-DG5-143: the auditor test matches approve/move write controls as whole words, and checks the matcher against the real catalogue in the test's language. |
| `apps/web/e2e/p4-raid-governance.spec.ts` | F-DG5-144: test 5 gets an explicit, measured 90 s budget and per-phase "timing" annotations. Steps and assertions are unchanged. |
| `docs/delivery/handbacks/DG5/T-DG5-FE-RG2-frontend-ux-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG5/T-DG5-FE-RG2-evidence/**` | Logs, Playwright JSON reports, two screenshots, and the runner script (`run-e2e.sh`). |

No product source, i18n catalogue, contract, schema or dependency changed. The product's Arabic labels are unchanged: no collision elsewhere called for a change (see the search below).

## F-DG5-143 (Medium): the auditor test reads the sort header «الاعتمادية» as an approve control

**Cause**

- At the old spec line 502, `getByRole("button", { name: /approve|اعتماد|move|نقل/i })` matched by **substring**.
- RG1 (F-DG5-120) added the critical-dependency slips table to the Dependencies page. Its sortable column header is the button «الاعتمادية غير مرتّب» ("Dependency, not sorted"), from `dependencies.slips.col.dependency` = «الاعتمادية».
- «الاعتمادية» contains the letters of «اعتماد» ("approve"). So the read-only sort control was counted as a write control in chromium-ar. The product was correct.

**Fix**

- `apps/web/e2e/p3-prioritization-roadmap.spec.ts:466-471`: the new constant `APPROVE_OR_MOVE = /(?<![\p{L}\p{M}])(?:approve|move|اعتماد|نقل)(?![\p{L}\p{M}])/iu`.
  - It matches the verbs as **whole words**: neither side may be a Unicode letter or combining mark.
  - Write labels still match: «اعتماد تاريخ …», «إعادة اعتماد تاريخ …», «اعتماد الإصدار …», «نقل …», "Approve …", "Re-approve …" and "Move …".
  - Labels that only contain the letters no longer match: «الاعتمادية», «اعتماديات», «إضافة اعتمادية», "Removed".
- `:530`: the assertion uses `APPROVE_OR_MOVE`.
  - It still counts **every** button in `main#main`, including disabled ones and ones inside `th`. Nothing is excluded by location, so the check is no weaker than before.
  - The test's other write-control check (the exact catalogue write labels, `:512-529`), the zero-mutating-requests check and the read-only-note check are unchanged.
- I verified that Playwright 1.56.1 passes `u`-flag regexes through unchanged. `escapeRegexForSelector` returns `String(re)` for unicode regexes, in `playwright-core/lib/utils/isomorphic/stringUtils.js:81-85`.

**Regression test (in the same test)**

- `:473-497` (constants at `:473-488`, checks at `:495-497`): `APPROVE_OR_MOVE_WRITE_KEYS` are the six approve/move write labels of the three screens: `prioritization.weights.approve`, `prioritization.weights.approveConfirm`, `roadmap.milestones.move`, `roadmap.milestones.approveDate`, `roadmap.milestones.reapprove` and `roadmap.milestones.approveConfirm`. The matcher must match each of them in the test's language. This guards against the fix weakening the check.
- `NOT_APPROVE_OR_MOVE_KEYS` are five read-only labels that contain the letters, including `dependencies.slips.col.dependency`. The matcher must not match any of them. This guards against the F-DG5-143 collision returning.
- Offline check of both matchers against both catalogues: `T-DG5-FE-RG2-evidence/02-matcher-catalogue-check.log`.
  - New matcher: all six write labels true and all five read-only labels false, in en and ar.
  - Old matcher: true on all five Arabic read-only labels, and on the sort-button name «الاعتمادية غير مرتّب».

**Failing before** (fix not yet applied; real stack, `--workers=1`, locale unset)

`01-before-p3prio-unset.log`: exit 1. **12 passed, 1 failed, 1 did not run.**

```
1) [chromium-ar] › apps/web/e2e/p3-prioritization-roadmap.spec.ts:542:1 › the read-only auditor: …
   Locator:  locator('main#main').getByRole('button', { name: /approve|اعتماد|move|نقل/i })
   Expected: 0
   Received: 1
```

The test that did not run is `capacity screen …` in chromium-ar, a serial follower. This reproduces qa's report exactly.

**Passing after** (real stack, `--workers=1`, both projects)

- Locale unset, `03-after-p3prio-unset.log`: exit 0, **14 passed (1.3 m)**. The auditor test took 7.5 s in ar.
- `LANG=LC_ALL=C.UTF-8`, `05-after-p3prio-cutf8.log` (with `.json`): exit 0, **14 passed (1.4 m)**.

Visual evidence: `T-DG5-FE-RG2-evidence/shots/p3-prioritization-aud-dependencies-{en,ar}.png` are the test's own screenshots from the locale-unset run after the fix. In Arabic they show the auditor's read-only Dependencies page with the slips table and its sortable «الاعتمادية» header present, and no write control. The test passes on that exact page.

**Note on line numbers:** Playwright reports this test as `:542`, while the test is declared at file line 490 (466 before this change). Playwright's reported line is off for every test in this spec (for example, setup is reported at `:110` but declared at `:132`). This is a reporting artefact of its TS transform, not a different file. I cite file lines here.

**Search of the other e2e specs for the same pattern (assignment scope)**

- A regex-name/`hasText`/`new RegExp` scan of `apps/web/e2e/**/*.ts` (86 hits) found no other substring match on «اعتماد», «نقل» or a similar short Arabic verb. Every other `new RegExp` built from catalogue text is anchored (`^…`) or targets one labelled control.
- A scan of every Arabic literal used as a matcher found only form fills, digit checks and fixed phrases that RG1's pages don't contain.
- `p3-journeys` test 7 (the auditor sweep over all P3 screens, Dependencies included) already excludes `thead`, the toolbar, the pager and the column picker. The slips sort headers cannot trip it.
- RG1 added these controls:
  - the slips `RegisterTable` on the Dependencies page and the Initiative page: search field, column picker, sort buttons and pager;
  - the reader table rendering;
  - the procedures launch note.
- qa's round-2 full product suite ran every spec on the RG1 candidate. Its only failures were F-DG5-143 and F-DG5-144, and the tests that did not run were their serial followers. All of those followers run and pass in my runs above and below.
- Result: no other spec needed a change.

## F-DG5-144 (Low): p4-raid-governance test 5 on the default 30 s budget

**Cause**

- Test 5 is one long serial chain over two signed-in users (lead and chair): create the meeting, refuse the incomplete ask, complete and publish it, start the meeting, record the outcome, then draft, approve and publish the minutes.
- It ran on Playwright's default 30 s budget. In qa's full-suite run it was cut at 30.1 s in chromium-ar (load about 7-8.5), with no failed assertion and no step above 1.8 s.

**Fix**

- `apps/web/e2e/p4-raid-governance.spec.ts:288-305`: a comment with the measured reason, `MEETING_WORKSPACE_BUDGET_MS = 90_000`, and a `phaseTimer()` helper.
- `:309`: `test.setTimeout(MEETING_WORKSPACE_BUDGET_MS)`.
- `:338, 355, 365, 380, 387, 397, 413, 434`: eight `mark("<phase>")` checkpoints. Each records the phase's elapsed time as a `timing` annotation, so a slow run names the slow phase.
- No step, assertion, screenshot or axe check was removed or changed. The diff only adds lines.
- Unlike F-DG5-141 I did not split the test: its later phases depend on the state of the earlier ones in the same signed-in sessions.

**Measured reason for 90 s**

| Measurement | Source | Result |
|---|---|---|
| Alone, qa round 2, load about 3 | qa evidence | 16.9 s / 16.5 s |
| Alone, this task, load about 2 | `04-…`, `06-…`, `07-…` | 13.3-15.2 s |
| Full suite, chromium-ar, completed runs | qa rounds 1-2 | 21.6 s, 25.0 s, 27.8 s |
| Full suite, chromium-ar, cut run (a lower bound) | qa round 2, unset | 30.1 s |

90 s is 3x the cut figure and more than 3x every completed loaded run. That is the same "at least 2x over a measured loaded case" rule as F-DG5-141, D-173 and F-DG5-121.

**Failing before**

I did not reproduce it myself: it only appears under full-suite load, and D-164 forbids me running the full suite. `T-DG5-FE-RG2-evidence/08-F-DG5-144-before-qa-excerpt.txt` is a read-only grep of qa's round-2 logs: `✘ 396 [chromium-ar] … p4-raid-governance.spec.ts:290:1 › 5. Meeting workspace … (30.1s)`, `Test timeout of 30000ms exceeded.`

**Passing after** (real stack, `--workers=1`, both projects)

| Run | Log | Result | Test 5 en / ar | Load |
|---|---|---|---|---|
| Locale unset | `04-after-p4raid-unset.log` | exit 0, **14 passed (1.7 m)** | 13.3 s / 13.9 s | about 2 |
| C.UTF-8 | `06-after-p4raid-cutf8.log` (with `.json`, `-test5-timing.txt`) | exit 0, **14 passed (1.7 m)** | 14.0 s / 13.3 s | about 2 |
| Locale unset, re-run on the final file | `07-final-p4raid-unset.log` (with `.json`, `-test5-timing.txt`) | exit 0, **14 passed (1.8 m)** | 14.7 s / 15.2 s | about 3 |

- The `04` run came before I reworded the budget comment. That edit was comment-only, but I re-ran (`07`) so the evidence covers the final file.
- Tests 6 and 7 (the serial followers that did not run in qa's run) pass in every run above.
- The phase timings show no phase above 3.5 s. The slowest are "minutes drafted, approved and published (axe)" at 2.9-3.5 s and "meeting created and chair set" at 2.6-3.2 s.

## Checks (real exit codes)

| # | Command (environment) | Exit | Result / counts | Evidence |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | PASS gate DG4 (historical) | `00-validate-dg4-start.log` |
| 1 | `pnpm -r typecheck` | 0 | | `10-pnpm__r_typecheck.log` |
| 2 | `pnpm -r build` | 0 | | `10-pnpm__r_build.log` |
| 3 | `pnpm lint` | 0 | | `10-pnpm_lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | All matched files use Prettier code style | `11-prettier-check.log` |
| 5 | `pnpm openapi:lint` | 0 | PASS, OpenAPI 3.1.1, 846 operations | `12-openapi-lint.log` |
| 6 | `npx vitest run --project unit-web` (locale unset) | 0 | 94 files, **1746 passed** | `13-unit-web-unset.log` |
| 7 | `npx vitest run --project unit-web` (`LANG=LC_ALL=C.UTF-8`) | 0 | 94 files, **1746 passed** | `13-unit-web-cutf8.log` |
| 8 | p3-prioritization-roadmap, before the fix (unset) | **1** | 12 passed, 1 failed (F-DG5-143), 1 did not run: **expected failing-before** | `01-before-p3prio-unset.log` |
| 9 | p3-prioritization-roadmap, after (unset) | 0 | 14 passed | `03-after-p3prio-unset.log` |
| 10 | p3-prioritization-roadmap, after (C.UTF-8) | 0 | 14 passed | `05-after-p3prio-cutf8.log` |
| 11 | p4-raid-governance, after (unset) | 0 | 14 passed | `04-after-p4raid-unset.log` |
| 12 | p4-raid-governance, after (C.UTF-8) | 0 | 14 passed | `06-after-p4raid-cutf8.log` |
| 13 | p4-raid-governance, final file (unset) | 0 | 14 passed | `07-final-p4raid-unset.log` |
| 14 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | PASS | `99-validate-dg4-end.log` |

- All e2e runs used `T-DG5-FE-RG2-evidence/run-e2e.sh`: `apps/web/e2e/support/with-stack.sh` (real stack, AUTH_MODE=dev, synthetic seed), `--workers=1`, chromium-en and chromium-ar, Node 24.21.0, with ports E2E_PG_PORT=23210, E2E_API_PORT=23220 and MTH_PORT_POOL=23200-23249.
- The only non-zero exit is check 8, the intended failing-before reproduction. No test was flaky or retried, and nothing timed out.
- **Not run (D-164):** the repository-wide `pnpm test`, `pnpm test:integration` and the full product e2e suite are left to the orchestrator's verification on the merged tree. No integration path is reached by this change.
- Only two specs changed, so no other spec run was required.
- I removed my temporary Playwright outputs and screenshot directories from `$TMPDIR`. No empty `.claude/.cc-writes` directories were found in source folders.

## Contract, schema, dependency

None needed. Nothing in the contract, `openapi.yaml`, the zod mirrors or the dependency list changed.

## ADR and data-dictionary statements made untrue or incomplete

None: the changes are test-only. If ADRs record the e2e budget practice (F-DG5-121, D-173, F-DG5-141), the architect may add p4-raid-governance test 5 (90 s, F-DG5-144) to that list. This is optional.

## User-facing text

No user-facing text changed, so no en or ar text became untrue.

## What remains

- The orchestrator's full product e2e on the merged tree (D-187), in both locale settings.
- Round-3 verification of F-DG5-143 and F-DG5-144 by qa-verifier. An author never closes their own finding.

**Workspace note:** the worktree has untracked files I did not create (`CLAUDE.local.md`, plus top-level dotfiles such as `.bashrc`, `.gitconfig`, `.mcp.json`, `.vscode`, `.idea`). Some were present at the start. I left them untouched and they are not part of this change.

## Merge instructions

Integrate the two modified spec files and the handback with its evidence directory. There are no migrations, no ordering constraints, and no conflicts expected: these two files are owned only by this task.
