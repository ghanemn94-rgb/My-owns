# Handback T-DG5-ARCH-RG1 (solution-architect): the wave-RG1 amendments

- **Stage:** P5, gate DG5, FIXING after clean re-gate round 1 (D-184, D-185).
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-ARCH-RG1-solution-architect-20261023T142137Z-aca531ab","session_id":"aca531ab-2d07-4d24-98a8-f2d2965cfcec"}`
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG5/T-DG5-ARCH-RG1.md`. Its sha256 `e58aceb95626ba993811d5666ca224ac7106c42fe0afffcc6046d0624d7a88ed` matches the value I was given.
- **Base:** worktree `/home/user/wt/dg5-arch-rg1`, branch `dg5/arch-rg1`, `HEAD` `3c1549f` (on top of the merges `1e6a545` BE-RG1 and `5474a66` FE-RG1).
- **Time:** started `Fri Oct 23 14:31:16 UTC 2026`, ended `Fri Oct 23 14:39:41 UTC 2026` (`date -u`).
- **Changes:** uncommitted, only under `docs/architecture/**`, plus this handback. No code, contract or test was changed.

I checked each claim in both handbacks' §5 against the merged code before writing it. Every amendment is dated 2026-10-23 and cites T-DG5-ARCH-RG1 and D-185, in the style of the existing amendments: lettered sections (E5, D21, B5, N3, V5), in-place italic markers, and "Corrected" markers for line references.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0003-persistence.md` | §Migrations: an in-place amendment bullet, plus a new section "Migration order (amendment, T-DG5-ARCH-RG1, 2026-10-23)" for F-DG5-100 |
| `docs/architecture/adr/ADR-0007-api-conventions.md` | §1: a readiness amendment saying `migrations: fail` also covers an out-of-order pending migration |
| `docs/architecture/p5-work-split.md` | Shared rule 16: the eight P5 gaps are retired and a new id goes above the highest shipped id. Also adds "stays unused permanently" markers in §A (0066–0067), §B.5, and the two equivalent sentences for the 0077–0079 and 0083–0084 ranges |
| `docs/architecture/p4-work-split.md` | The orchestrator's "fill unused numbers" note is marked superseded for P5 and later |
| `docs/architecture/adr/ADR-0046-…-export-jobs.md` | E1: corrected the CSV line reference and mechanism in place. New amendment E5 (F-DG5-101) |
| `docs/architecture/adr/ADR-0050-…-walkthrough.md` | §4: an in-place marker. New amendment D21: the Day-90 test is part of the roaming launch plan (F-DG5-121) |
| `docs/architecture/data-dictionary.md` | `day_ninety_test` "Who writes": adds the demo seed (synthetic) |
| `docs/architecture/adr/ADR-0044-…-notification-policy.md` | §7: an in-place marker. New amendment B5: the screens that show the slip impact (F-DG5-120) |
| `docs/architecture/adr/ADR-0049-…-branding.md` | §1: an in-place marker. New amendment N3: how table blocks are rendered, with storage staying verbatim (F-DG5-122) |
| `docs/architecture/adr/ADR-0042-…-coverage.md` | §9 launch row: an in-place marker. New amendment V5: launch is offered only with `procedure.launch`, as a UI hint (F-DG5-140) |

## 2. Behaviour delivered: item → amendment → evidence

| Item (assignment) | Amendment | Evidence (`file:line`) |
|---|---|---|
| ADR-0003 §Migrations: the runner refuses a pending id that is not above the highest applied id (F-DG5-100, REQ-S19-013) | §Migrations bullet (`_Amended 2026-10-23…_`); new section "Migration order". It also states the "database newer than the build" refusal, which the code already had and the ADR did not | `packages/db/src/migrate.ts:39`, `:102–103`, `:163–174`; `packages/db/src/cli.ts:90–98`; tests `packages/db/src/migrate.test.ts:16`, `:44`; `packages/db/test/integration/migrate.test.ts:122`, `:143`, `:162` |
| p5-work-split rule 16: the eight gaps are retired, a new id goes above the highest shipped id, and the p4 note is superseded for P5 | Rule 16 amendment; markers at §A (0066–0067), §B.5 (0073), the 0077–0079 and 0083–0084 range sentences; `p4-work-split.md` orchestrator note marked superseded | `packages/db/src/seed.test.ts:761` (`P5_RETIRED_MIGRATION_IDS = [66, 67, 73, 77, 78, 79, 83, 84]`), `:775`, `:792`; `ls packages/db/migrations` shows exactly those eight ids missing between 0062 and 0097 |
| ADR-0007 / readiness: `migrations: fail` also covers an out-of-order pending migration | ADR-0007 §1 amendment. The contract is unchanged (enum `ok \| pending \| fail`) | `apps/api/src/modules/platform/health.ts:48–52`, `:60–63`; `docs/api/openapi.yaml:26608`; test `apps/api/test/integration/platform.test.ts:49` |
| ADR-0046 §4 and notes: long negative decimals are unprefixed; corrected the `csv.ts` line reference and the mechanism (F-DG5-101, REQ-S13-006) | E1 corrected in place (`csv.ts:66–68` → `:71–73`; mechanism: `textRow` → `textCell` decides `quotePrefix` once, and `csvCell` writes it); new E5 | `packages/reporting/src/csv.ts:45–56` (the text case at `:54`), `:59`, `:71–73`; `packages/reporting/src/model.ts:196–198`, `:201–208`; tests `packages/reporting/src/csv.test.ts:136`, `:151`, `:158`, `:171`, `:178`; `packages/reporting/src/xlsx/xlsx.test.ts` (the F-DG5-101 case) |
| ADR-0050 §4/§5 and the dictionary: the launch plan includes its Day-90 test; `day_ninety_test` is also written by the demo seed (F-DG5-121, REQ-PB-087) | §4 marker; new D21 (§5 explicitly unchanged); dictionary "Who writes" amended | `packages/db/src/demo/data/roaming-states.ts:26`, `:28`, `:85`, `:107–108`; tests `packages/db/test/integration/demo-roaming.test.ts:306` (scheduled 2026-10-01, day 90, open, 0 answered, 1 audit event, 1 registered), `:364`; `apps/api/test/integration/environment/demo-day-ninety.test.ts:62`, `:63`, `:71`, `:84`, `:110` |
| ADR-0044 §7: name the screens that show the slip impact (F-DG5-120, REQ-S12-012) | §7 marker; new B5 (the Dependencies page "Critical dependency slips", the initiative page section, and the work-item text from `messageParams`; the roadmap is unchanged) | `apps/web/src/pages/dependencies/slips.tsx:28`, `:66`, `:106`; `apps/web/src/pages/dependencies/DependenciesPage.tsx:119`; `apps/web/src/pages/portfolio/InitiativePage.tsx:172`; `apps/worker/src/handlers/portfolio.ts:20`, `:61`; `apps/web/src/i18n/en/myWork.json:127`, `ar/myWork.json:127`; tests `slips.test.tsx:59`, `:67`, `:78`, `:110`, `:115`; `apps/web/e2e/p5-dependency-slip-impact.spec.ts:152` |
| ADR-0049 §1: table rendering (previews show cells as text; a one-cell table is a wrapping callout); storage stays verbatim (F-DG5-122, REQ-S03-010) | §1 marker; new N3 | `apps/web/src/pages/playbook/ui.tsx:36`, `:48`, `:55`, `:66`, `:79`, `:132`, `:136`, `:213`; `apps/web/src/styles/app.css:782–789`; tests `apps/web/src/pages/playbook/reader-tables.test.tsx:119`, `:127`, `:135`, `:152`, `:169`; `apps/web/e2e/p5-reader-tables.spec.ts:76` |
| ADR-0042 §4: My procedures offers launch only with `procedure.launch` (a UI hint; the server check is unchanged) (F-DG5-140, REQ-S06-002) | §9 launch-row marker; new V5 | `apps/web/src/pages/procedures/MyProceduresPage.tsx:208`, `:211`, `:226`; `apps/web/src/i18n/en/workflowsP5.json:240`, `ar/workflowsP5.json:240`; `apps/api/src/modules/procedures/instances.ts:293`; tests `launch-permission.test.tsx:60`, `:77`; `apps/web/e2e/p5-launch-permission.spec.ts:15`, `:63` |

Statements I made more precise than the handbacks suggested, or verified differently:

- **ADR-0050.** §4/§5 do not literally contain "the launch plan with its template tasks". That phrase is in the `roaming-states.ts` header. So D21 adds the Day-90 test to §4's dataset description. §5 states that no coverage condition reads the launch plan or the Day-90 test: `coverage.ts` has no launch or Day-90 condition.
- **ADR-0044 B5.** I name the `renderMessage` consumers I found for work items: My Work (`MyWorkPage.tsx:121`) and the personal dashboard's My Work sections (`MyWorkSections.tsx:27`). The FE handback says "inbox". I did not name a separate inbox screen, because I found none in the diff. B5 also states that the roadmap does not show the slip: no roadmap file changed, and F-DG5-120 had named it.
- **ADR-0042 V5.** The form is gated on `canAnywhere(me, "procedure.launch")`. A user who holds `procedure.launch` but none of a definition's launch roles still sees the form and gets 403 `procedure.launch_role`. V5 says so.

## 3. Checks actually run

Environment: the sandboxed worktree `/home/user/wt/dg5-arch-rg1`, Linux, the repository's node and npx.

| Command | Result |
|---|---|
| `node tools/gates/validate.mjs --historical --stage DG4` (start, 14:31 UTC) | `PASS gate DG4 (historical)`, exit 0 |
| `git ls-files -co --exclude-standard -z -- docs/architecture \| xargs -0 npx prettier --check --ignore-unknown` (after all edits) | `Checking formatting...` / `All matched files use Prettier code style!`, exit 0 (63 files; only npm config warnings otherwise) |
| `node tools/gates/validate.mjs --historical --stage DG4` (end, 14:39 UTC) | `PASS gate DG4 (historical)`, exit 0 |

Not run, and not needed for a documentation-only change: unit, integration and e2e suites. I cite the RG1 tests by file and line only. I did not re-run them. Their results are the implementers' evidence (`docs/delivery/test-evidence/DG5/T-DG5-BE-RG1-evidence/`, `…/T-DG5-FE-RG1-evidence/`).

## 4. Known gaps / not done

- **The assignment names "ADR-0042 §4".** In ADR-0042, §4 holds the state machines, which are unchanged. The launch permission is in §9. V5's title names §4 and §9, its sources note says so, and the in-place marker is on the §9 "launch" row.
- **Untracked files I did not create.** The worktree had them before I started (`.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc`, `CLAUDE.local.md`). I did not touch them. Do not integrate them.
- **Line references are as of `3c1549f`.** A later merge that shifts these files will need the references refreshed.
- No contract, migration or test changes, and none needed: every RG1 change is additive or UI-only, and the OpenAPI readiness summary and enum stay true.

## 5. Merge instructions

- Commit the ten modified `docs/architecture/**` files and this handback as they are. There are no migrations and no ordering constraints.
- The candidate's documentation set changes, so recompute the DG5 candidate ID after integration.
- Expect no conflicts: no other task runs (D-004).

Product gates G1–G6 are business approvals inside the product, and nothing here grants one or touches the engineering gates DG0–DG7. The demo Day-90 test is synthetic illustrative data. The playbook is a practical synthesis inspired by PMI, Brightline and BRM, not an official PMI standard.
