# Handback T-DG3-BE-F: G4 treats an Unknown schedule as a blocking item (backend-workflow-engineer)

- **Stage:** P3 / DG3 (BUILDING). **Task:** T-DG3-BE-F. **Decision:** D-079 (orchestrator, recorded at the freeze; not yet in `decisions.md` in this tree).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG3-T-DG3-BE-F-backend-workflow-engineer-20261008T040415Z-bdf41c37","session_id":"bdf41c37-9bc6-4341-a110-f8c1c7c3e67e"}`
- **Assignment:** `docs/delivery/assignments/DG3/T-DG3-BE-F.md` (sha256 `207da9cc84442b7544acfec226190f956a3504dbf10fb1c917176f0523287923`, verified).
- **Worktree / base:** `/home/user/wt/dg3-be-f`, branch `dg3/be-f`, base `f779a7be368753344f65149bde5b4024eba906ee`. Uncommitted: the orchestrator merges.
- **Time:** start `Thu Oct 8 04:04:23 UTC 2026`, end `Thu Oct 8 04:17:25 UTC 2026`.
- **Migrations:** none. **API endpoints added:** none. **Contract / route changes:** none.

G4 is a business approval inside the product. Nothing here approves anything, and nothing touches DG0–DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/workflows/g4.ts` | Adds `PortfolioGateFacts.scheduleUnknowns`. `g4.roadmap` lists `g4.schedule_unknown` → 'Schedule unknown: {dependency code}', pointer `/dependencies/{id}`. If `scheduleUnknowns` was not loaded, the criterion fails closed with 'Roadmap'. |
| `apps/api/src/modules/portfolio/gate-facts.ts` | `scheduleConflicts()` becomes `scheduleItems()`. It computes BE-C's `computeScheduleFlags` once and returns both `scheduleConflicts` (`schedule.needed_by_conflict`) and `scheduleUnknowns` (`schedule.unknown`). Both use the same filter: unresolved, into an in-scope initiative, blank mitigation. The schedule rule is not re-implemented. |
| `apps/api/src/modules/workflows/g4.test.ts` | Unit test: the `g4.schedule_unknown` item (exact code, message, pointer). Missing `scheduleUnknowns` facts fail closed (`g4.roadmap_missing` 'Roadmap'). |
| `apps/api/test/integration/gates/g4.test.ts` | New integration `describe` (real PostgreSQL). The G4 submission is refused (422) and lists 'Schedule unknown: DEP-nn' for two dependencies. A mitigation clears one item, and setting the missing needed-by date clears the other. |
| `apps/web/src/i18n/en/gates.json` | `missingItems.g4__schedule_unknown`: 'Schedule unknown'. |
| `apps/web/src/i18n/ar/gates.json` | `missingItems.g4__schedule_unknown`: 'الجدول الزمني غير معروف' (provisional). |
| `docs/architecture/adr/ADR-0021-p3-portfolio-initiative-lifecycle-g4.md` | §7 `g4.roadmap` row now covers the Unknown schedule and the new code. §11 item 3 replaces "Unknown is not listed by G4" with the D-079 rule. |
| `docs/architecture/adr/ADR-0023-p3-roadmap-dependencies-capacity-funding.md` | §1 is corrected to the built wave model. The editable fields are `planned_start`, `planned_end`, `owner_user_id`, `notes` and `status`. The verbatim source text is the label; a team-added wave carries its own name; there are no label overrides in P3. No columns were added. |
| `docs/architecture/p3-work-split.md` | §9: new "Amendments in wave 6" with item 22 (one line). |
| `docs/delivery/handbacks/DG3/T-DG3-BE-F-backend-workflow-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG3/T-DG3-BE-F-evidence/*` | Logs and `exit-codes.txt`. |

FE-A's G4 view needed no code list. `GateDetailPage.tsx` resolves every item generically with `gates.missingItems.${code.replace(/\./g, "__")}`, so the JSON keys are the only web change.

## 2. Behaviour delivered (D-079)

`g4.roadmap` now has three item kinds:

- `g4.roadmap_missing` (unchanged);
- `g4.schedule_conflict` (unchanged);
- **new:** `g4.schedule_unknown`, defined below.

A dependency gets a `g4.schedule_unknown` item when all four of these hold:

- it is unresolved (not `resolved`, not `archived`);
- it points **into** an in-scope initiative (`selected`, `funded` or `launched`);
- it carries the BE-C T08 flag `schedule.unknown`;
- its `mitigation` is blank.

The item is:

```json
{ "code": "g4.schedule_unknown", "message": "Schedule unknown: DEP-02", "pointer": "/dependencies/<id>" }
```

- **How the item clears:** record a mitigation on the dependency, or resolve the unknown dates. Either makes the flag or the filter no longer apply. The T08 flag itself stays visible on T07/T08.
- **Both flags:** a dependency with both `schedule.needed_by_conflict` and `schedule.unknown` is listed under both codes. For example, a known late predecessor whose successor has no planned start. Each code reflects a real flag, and one mitigation clears both. This is recorded in ADR-0021 §11 item 3.
- **Fail closed:** without the `scheduleUnknowns` fact (an unwired provider), `g4.roadmap` returns 'Roadmap' (`g4.roadmap_missing`) and stays incomplete. It never reads as "no conflict".
- **The 422 shape is unchanged:** there is one entry per incomplete criterion. Its `code` is the first item's code and its `message` joins the item messages. In the integration test, the `/criteria/g4.roadmap` entry has `code` `g4.schedule_unknown` and its message contains 'Schedule unknown: DEP-nn' for both dependencies. The gate view's `criteria[].missing` lists them separately, ordered by dependency code.
- **Integration scenario (synthetic data):**
  - Setup:
    - one complete selected initiative (the successor);
    - a draft initiative with planned dates 2026-07-01 to 2026-12-31 (the predecessor);
    - an external-predecessor dependency with needed-by 2027-01-01, Unknown because the product holds no external finish;
    - an initiative-to-initiative dependency with no needed-by date (Unknown).
  - Steps and results:
    1. Submit: 422 listing both items, with no audit event written.
    2. PATCH a mitigation on the external dependency: only the other item remains.
    3. PATCH `neededBy: 2027-12-31`, which is after the predecessor's finish: there are no `g4.schedule_*` items left.
    4. A further submission no longer contains "Schedule unknown".
- **Existing tests:** every existing G4 test is unchanged and green. The end-to-end G4 test creates no dependencies, so it does not reach the new item and needed no change.

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. Disposable PostgreSQL 16.13 via `tests/qa/support/with-pg.sh`, port 23450 (pool 23451–23499). Empty `.cc-writes` directories in source folders were removed before each test run. Exit codes are in `T-DG3-BE-F-evidence/exit-codes.txt`.

| # | Command | Exit | Result / log |
|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG2` (before work) | 0 | `PASS gate DG2 (historical)`, `validate-dg2-start.log` |
| 1 | `pnpm -r typecheck` | 0 | `typecheck.log` |
| 2 | `pnpm -r build` | 0 | `build.log` |
| 3 | `pnpm lint` | 0 | `lint.log` |
| 4 | `pnpm openapi:lint` | 0 | `openapi-lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!", `prettier.log` |
| 6 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | 80 files, 1523 tests passed, `test-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | 80 files, 1523 tests passed, `test-c-utf8.log` |
| 8 | `QA_PG_PORT=23450 MTH_PORT_POOL=23451-23499 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | 55 files, **788 tests passed**, no failures, no hook timeouts. PostgreSQL on 23450 (attempt 1). `test-integration.log` |
| 9 | `node tools/gates/validate.mjs --historical --stage DG2` (at the end) | 0 | `PASS gate DG2 (historical)`, `validate-dg2-end.log` |

Checks 1–9 ran on the final tree; check 5 ran before this handback existed. Every non-zero exit during development is disclosed below. None of them is cited as evidence.

- **First `pnpm -r typecheck`: exit 2.** The new unit test set `scheduleUnknowns: undefined`, which `exactOptionalPropertyTypes` rejects. The test now omits the property. Re-run: exit 0 (row 1).
- **First targeted run of `vitest --project integration apps/api/test/integration/gates/g4.test.ts`: exit 1.** The new test called `selectedInitiative` twice in one world. The shared fixture `makeDirection` creates a fixed-name KPI, so the second call failed with 409 `duplicate.name`. The fix was to make the predecessor a draft initiative with planned dates; shared fixtures were not edited. Re-run: exit 0, 5/5 (`g4-integration-targeted.log`), then the full suite (row 8).
- **First `vitest` invocation from `apps/api/`:** it failed to start because of a relative workspace path. It was re-run from the repository root.

`grep "failed"` on `test-integration.log` matches only the title of a passing worker test ("moves a job that keeps failing to ops.failed…"). It is not a failure.

## 4. Known gaps / notes

- D-079 is cited in code and ADR text, but it is not yet in `docs/delivery/decisions.md`. The assignment says the orchestrator records it at the freeze.
- The untracked top-level entries in the worktree are not part of this work: `.bashrc`, `.zshrc`, `.mcp.json`, `.idea`, `CLAUDE.local.md` and others. They are sandbox character-device mounts, so leave them out of the commit.
- The Arabic label is provisional, as the assignment states.

## 5. Merge instructions

- No migrations, no route, contract or OpenAPI changes, and the contract counts are unchanged.
- **Possible conflicts:**
  - `docs/architecture/p3-work-split.md`: I appended a "wave 6" subsection. Another wave-6 amendment could conflict there; renumber if needed.
  - `apps/web/src/i18n/{en,ar}/gates.json`: one added line each, next to `g4__schedule_conflict`.
- No overlap with FE-D (`apps/web/e2e/p3-journeys.spec.ts`) or the analyst (`docs/delivery/requirements.csv`).
