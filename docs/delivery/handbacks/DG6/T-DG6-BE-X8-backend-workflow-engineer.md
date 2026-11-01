# Handback T-DG6-BE-X8 (backend-workflow-engineer): observed proficiency at a month boundary

- **Stage:** DG6 (P6), pre-freeze repair. **Invocation:** `DG6-T-DG6-BE-X8-backend-workflow-engineer-20261031T222408Z-327c2e68` (session `327c2e68-2c4c-4f78-95c5-ae4ba55b717b`).
- **Base:** branch `dg6/be-x8` at `9d39b1a1c` (code identical to `5aa85ba4c`, i.e. `70957f5` plus the webhook test fix). The changes are **uncommitted**, as the assignment asks.
- **Time:** started `Sat Oct 31 22:24:22 UTC 2026`; ended `Sun Nov  1 00:03:14 UTC 2026` (about 99 minutes).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` exited **0** (`PASS gate DG5 (historical)`) at the start, and again at the end (see Checks).

## Assignment gap (reported, not guessed)

The binding section, "`docs/architecture/p6-work-split.md` pre-freeze repair: observed proficiency (REQ adoption, P4)", **does not exist** in `p6-work-split.md` on this branch. The file has 711 lines, and `grep -i "pre-freeze\|proficien\|X8\|adoption"` finds only the BE-J2 worker-handler line. So no section-level file ownership, contract or requirement rows were available. I used the assignment text itself as the scope, applied all twenty §2 shared rules, and touched only the files the repair needed. The requirement rows I quote below come from the code and spec under repair (REQ-PB-072, REQ-S11-002).

## Root cause

**A product defect, latent since DG4. It is not a P6 regression, and the spec was not wrong.**

- `apps/web/src/pages/adoption/FormsPage.tsx` (the form-response dialog, `RespondDialog`) defaulted the observation date to the **UTC** date: `useState(new Date().toISOString().slice(0, 10))`. `git log -S` dates this line to `8b8f8a4c5` (2026-10-10, DG4).
- `GET /transformations/{t}/adoption-indicators` (`apps/api/src/modules/adoption/indicators.ts`, around line 616) picks its default reporting period from the **business date** in the organization's zone: `p4_business_date(now(), tz)`, where `tz` is the default calendar's zone, else the organization's (default Asia/Riyadh, ADR-0025 §2). It then counts only observations with `observed_on` inside that period (`observed_on >= period.start AND <= period.end`; `observedProficiency` in `packages/shared/src/adoption/measures.ts`).
- From 00:00 to 03:00 Asia/Riyadh, the UTC date is still the previous day. On the 1st of a month, that is the previous **month**. The failing runs started just after midnight Riyadh on 2026-11-01. The training record's `completedOn` was `day(0)`, a Riyadh date (2026-11-01), so completion showed 100 %. The form observation was stored with `observed_on = 2026-10-31`, outside the November period the API selected. So `observed_proficiency` stayed Unknown, and `[data-value-status='ok']` never appeared. This explains the failure, why it was deterministic in both languages, and why it passed on every earlier run (none fell in the 00:00–03:00 Riyadh window of a 1st).
- **P6 regression ruled out:** `git log a065f3d2..HEAD` (`a065f3d2` is the DG5 approval commit, 2026-10-26) over `apps/web/src/pages/adoption`, `apps/api/src/modules/adoption`, `packages/shared/src/adoption` and the spec returns **no commits**.
- The server side was already consistent: period selection and `observed_on` filtering both use business dates. The only inconsistent piece was the client default. A user who kept the prefilled date between 00:00 and 03:00 Riyadh on any day had the observation recorded one day early, and on the 1st it fell in the previous month's measure.

## Changed files

| File | Purpose |
| --- | --- |
| `apps/web/src/lib/format.ts` | New pure `businessDateIn(timeZone, now = new Date())`: today's `YYYY-MM-DD` in the given zone (Intl, no dependency). The zone is a parameter, never hardcoded. |
| `apps/web/src/pages/adoption/FormsPage.tsx` | `RespondDialog` defaults `observedOn` to `businessDateIn(me.organization.defaultTimezone ?? DEFAULTS.timezone)` instead of the UTC date. The field stays editable and required. |
| `apps/web/src/lib/lib.test.ts` | Unit test at the month boundary: 2026-10-31T21:30Z → `2026-11-01` in Riyadh and `2026-10-31` in UTC; 20:59:59Z / 21:00:00Z on either side of Riyadh midnight; a year boundary (2026-12-31T22:00Z → `2027-01-01`); a configured non-default zone (America/New_York). |
| `apps/web/src/pages/adoption/adoption.test.tsx` | Component test, en and ar: the clock is set to 2026-10-31T21:30Z (00:30 on 1 November in Riyadh). The dialog's observation date shows `2026-11-01`, and the POST body carries `observedOn: "2026-11-01"`. **Verified to fail against the old UTC default** (2 failed, en and ar) and to pass with the fix. |
| `apps/web/e2e/p4-adoption-bau.spec.ts` | Step 4 also asserts that the response dialog's observation date defaults to `day(0)` (today's Riyadh business date). This adds an assertion and weakens nothing. No new spec, so no new budget. Step 4 measured 9.3 s (en) and 9.1 s (ar) on this host, inside the existing default. |

No API, schema, migration, OpenAPI or zod change. **Migrations: none** (the highest file is still `0121_p6_notification_fanout_jobs.sql`). **Endpoints added: none.**

## Behaviour delivered, per requirement row

- **REQ-PB-072**: acceptance "A11: 100% training completion with no proficiency observations shows proficiency Unknown, not adopted". Unchanged and still proven. e2e step 4 shows completion `ok` 100 and proficiency `unknown` "Unknown" in both languages, at 01:31–01:34 Riyadh on 2026-11-01, in the failure window. The measure code (`measures.ts`) is untouched: proficiency is still never derived from training.
- **REQ-S11-002**: acceptance "A11: a proficiency observation submitted via the form links to the stakeholder group and counts in the proficiency indicator". Repaired for the 00:00–03:00 Riyadh window. A form observation submitted with the default date is now dated on the business date the indicator's period uses, so it counts. e2e step 4 shows `observed_proficiency` `ok` 100 after the form response, in en and ar, at a month boundary. The component test pins the boundary deterministically, without depending on when it runs.

## Checks actually run (environment: this worktree, Node 24.21.0, offline; logs in `docs/delivery/handbacks/DG6/T-DG6-BE-X8-evidence/`)

| Command | Exit | Result |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG5` (start) | 0 | `PASS gate DG5 (historical)` |
| `pnpm --filter @mth/web build` (before the e2e run) | 0 | built |
| `E2E_PG_PORT=27551 E2E_API_PORT=27552 MTH_PORT_POOL=27553-27599 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/p4-adoption-bau.spec.ts --workers=1`, run 22:31–22:34 UTC = 01:31–01:34 Asia/Riyadh on **2026-11-01** | 0 | **16 passed** (8 steps × chromium-en, chromium-ar); step 4 passed in both. `e2e-adoption-fixed.log` |
| `npx vitest run src/pages/adoption/adoption.test.tsx -t BE-X8` with the old UTC default restored temporarily (negative control) | 1 | 2 failed (en, ar), as expected. The fix was then restored. |
| `npx vitest run src/lib/lib.test.ts src/pages/adoption/adoption.test.tsx` | 0 | 49 passed |
| `pnpm -r typecheck` | 0 | `typecheck.log` |
| `pnpm -r build` | 0 | `build.log` |
| `pnpm lint` | 0 | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" `prettier.log` |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations`. My first attempt ran `pnpm openapi` by mistake (a shell loop split the name at the colon), which exited 254 "Command not found". The correct command was re-run, and its log overwrote that attempt. |
| `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | 0 | unit-node 186 files / 2803 tests passed; unit-web 120 / 2018 passed; unit-formula-nocodegen 3 / 259 passed and 2 skipped (the pre-existing skips in `formula/fuzz.test.ts`). `test-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | same counts: 186/2803, 120/2018, 3/259 (+2 skipped). `test-c-utf8.log` |
| `QA_PG_PORT=27560 MTH_PORT_POOL=27561-27599 tests/qa/support/with-pg.sh pnpm test:integration` | **not obtained** (stopped) | **INCOMPLETE, not reported as passed.** I started it in the background with a 1-hour limit (my choice, below the allowed maximum). The harness stopped it at that limit (`Sun Nov  1 00:01 UTC`) after **390 test files had passed and 0 had failed**. The orchestrator's run at this code had 407 files, so roughly 17 files never ran, and there is no final summary or exit code. Restarting would have exceeded the assignment's 2-hour limit. My change is web-only (no API, DB, worker or shared code), so the integration suite does not exercise it. The run left no PostgreSQL behind (`ss` shows no listener on 27550–27599). Partial log: `integration.log` |
| `node tools/gates/validate.mjs --historical --stage DG5` (end) | 0 | `PASS gate DG5 (historical)` (00:03 UTC) |

unit-web gains 3 tests (the unit test, plus the component test in en and ar). I didn't measure a baseline count before the change. No pinned count changes: `contract.test.ts` and the operation count are untouched.

## Operations routed (pending-list delta)

None. No operation was added, routed or removed, and no `p6-pending-*.ts` or `p6-exercises-*.ts` file changed.

## Contract, schema or dependency needs

None. No new dependency: `businessDateIn` uses the platform `Intl.DateTimeFormat`.

## User-facing texts

No en/ar string changed or became untrue. The observation date field keeps its label (`adoptionP4.records.observedOn`); only its default value is corrected.

## What remains (residuals for the orchestrator)

1. **Zone source on the client.** The server's business zone is "the default calendar's zone, else the organization's" (`businessTimezone`, indicators.ts). The web session has no calendar zone, so the dialog uses `me.organization.defaultTimezone ?? DEFAULTS.timezone`. These agree on the seed (both Asia/Riyadh). Where an organization sets a default calendar in a different zone, the prefilled date could still differ by a day, but it stays editable and the server's arithmetic is unaffected. A complete fix would expose the business zone (or today's business date) on `GET /me` or the indicators response. That is a contract change I did not make.
2. **Same defect class elsewhere (outside this repair's scope, not changed).** `apps/web/src/pages/procedure-builder/DefinitionPage.tsx:113` (`const today = () => new Date().toISOString().slice(0, 10)`) and `apps/web/src/pages/traceability/ModularPage.tsx:62` also take a UTC date where a business date may be meant. Their owners should check them with `businessDateIn`.
3. **Acceptance item 3 (`pnpm test:integration`) is incomplete**: 390 files passed and 0 failed before the stop, and about 17 files never ran. The orchestrator should re-run it on the merged tree (it takes over 60 minutes on this host). No pinned count changed.
4. I ran only the adoption e2e spec (both languages), not the whole e2e suite. The orchestrator's full run remains the integration check.

## Merge instructions

No migrations, no ordering constraints. The five changed files are web-only. A conflict is possible only if another task edits `RespondDialog` in `FormsPage.tsx`, or the `dates` block of `lib.test.ts`.
