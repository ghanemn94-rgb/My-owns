# Handback T-DG4-BE-R4 (backend-workflow-engineer): implement ARCH-R3 (three reads, `Problem.params`, `forumAr`)

- **Stage:** DG4 (BUILDING). Worktree `/home/user/wt/dg4-be-r4`, branch `dg4/be-r4`, at the integrated `HEAD` `48eba105a78c21096a34163ffaf619f3cf6e0132` (D-114). The changes are **uncommitted**, for the orchestrator to integrate.
- **Invocation:** `DG4-T-DG4-BE-R4-backend-workflow-engineer-20261010T124126Z-6f55b1f8` (session `6f55b1f8-8787-443a-97ff-925dcea1630a`). I checked the assignment `docs/delivery/assignments/DG4/T-DG4-BE-R4.md` with `sha256sum` before starting: `e88ff6b58c8fee58645707902abececcddf17dea8e7859ace1423a9545d2a569`, which matches the hash I was given.
- **Time:** start `Sat Oct 10 12:41:39 UTC 2026` (`evidence/start-time.txt`); end: see §6.
- **Preceding gate:** before any edit, `node tools/gates/validate.mjs --historical --stage DG3` printed `PASS gate DG3 (historical)` and exited 0 (`evidence/validate-dg3-historical-start.log`). The re-run at the end is in §3.
- **Two gate systems.** This task writes no DG0–DG7 record other than this handback and its evidence. G1–G6, the G5 scale scope and the Modular waiver are business approvals inside the product. The G5 decisions and waiver decisions in the tests are synthetic, made by test persons, and approve nothing real. Product G6 never implies DG7.
- **Ports and disk.** Every PostgreSQL harness run used port 25950 with `MTH_PORT_POOL=25951-25999`. `df -h .` showed 17 GB free before each full run (D-104 threshold: 3 GB).
- **Untracked files I did not create:** the top-level `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc` and `CLAUDE.local.md` were present before my first edit (the sandbox's mounts, as ARCH-R3 also recorded). I left them untouched.
- **Write-guard directories.** The write guard creates empty `.claude/.cc-writes` directories in the folders I edit. I removed the empty ones (`find … -empty -delete`) before every test run, as the assignment asks.

## 1. Changed files

**Source (6 API files, 3 shared files):**

| File | Purpose |
|---|---|
| `apps/api/src/modules/portfolio/schedule-network.ts` | Item 1: `getInitiativeSchedule` (`GET /api/v1/initiatives/{initiativeId}/schedule`), exported `getInitiativeSchedule()`, and the route-list line |
| `apps/api/src/modules/workflows/scale.ts` | Item 2: `listScaleScopeBusinessUnits` (`GET …/scale-scope/business-units`), exported `listScaleScopeBusinessUnits()` and `SCALE_SCOPE_BUSINESS_UNITS`, and the route-list line |
| `apps/api/src/modules/adoption/assessments.ts` | Item 3: `getAssessmentFormVersion` (`GET …/assessment-forms/{assessmentFormId}/versions/{versionNo}`). The version presenter is factored into `toFormVersion`, which `toAssessmentForm` now uses for `currentVersion` (same members, same order) |
| `apps/api/src/modules/platform/problem.ts` | Item 4: `HttpProblem` gains an optional `params` field; `toBody` emits it after `currentVersion`, only when it is defined |
| `apps/api/src/modules/workflows/gates.ts` | Item 4: `gateModularWaiverRevoked(date)` and `gateModularWaiverExpired(date)` send `params: { date }`. Status, type, title, code and detail are unchanged |
| `apps/api/src/modules/governance/minutes.ts` | Item 5: `minutesTask` selects `name_ar` as well and passes `forumAr` |
| `packages/shared/src/problem.ts` | Item 4: `ProblemDetails.params?` |
| `packages/shared/src/schemas/problem.ts` | Item 4: the zod mirror `problem` gains `params` (exactly the ADR-0038 Q1 shape) |
| `packages/shared/src/schemas/gates-p4.ts` | Item 2: the zod mirrors `scaleScopeBusinessUnit` and `scaleScopeBusinessUnitPage` of the contract's `ScaleScopeBusinessUnit(Page)`. ARCH-R3 added the contract schemas but no mirror; the contract test needs one for every exercised operation. See §5 |

**Tests and seams:**

| File | Purpose |
|---|---|
| `apps/api/test/support/p4-pending-arch-r3.ts` | Emptied (3 → 0), with a comment naming where each operation is routed and exercised |
| `apps/api/test/integration/contract/p4-exercises-be-e.ts` | Exercises `getInitiativeSchedule`: after the create (200, `ETag` equal to the create's `"1"`, body equal to the create's), after the update (`"2"`), ADM-only 404, and an initiative with no row (404 `not_found`). Mirror `initiativeSchedule` |
| `apps/api/test/integration/contract/p4-exercises-be-k.ts` | Exercises `listScaleScopeBusinessUnits`: the Sponsor reads org A's units, not org B's; cursor paging; ADM-only 404. Mirror `scaleScopeBusinessUnitPage` |
| `apps/api/test/integration/contract/p4-exercises-be-h.ts` | Exercises `getAssessmentFormVersion`: version 1 (200, no `ETag`, equal to the create's `currentVersion`), version 99 (404), ADM-only 404. Mirror `assessmentFormVersion` |
| `apps/api/test/integration/portfolio/initiative-schedule-read.test.ts` (new) | Item 1 behaviour, 3 tests |
| `apps/api/test/integration/workflows/scale-scope-business-units.test.ts` (new) | Item 2 behaviour, 4 tests |
| `apps/api/test/integration/adoption/assessment-form-version.test.ts` (new) | Item 3 behaviour, 2 tests |
| `apps/api/test/integration/workflows/modular-waiver.test.ts` | Item 4: a new `describe` with 4 tests (revoked, expired, no other problem gains the member, and the A/B transcript of the refusals). No existing test line changed; the file header gains two comment paragraphs |
| `apps/api/test/integration/governance/minutes.test.ts` | Item 5: one new test (both names on a new item). No existing line changed |
| `apps/api/test/integration/workflows/be-r4-ab-transcript.test.ts` (new) | The A/B byte-stability transcript of the touched modules' existing responses (4 tests; it records only when `MTH_BE_R4_TRANSCRIPT` is set, and is an ordinary regression test otherwise) |
| `docs/delivery/handbacks/DG4/T-DG4-BE-R4-backend-workflow-engineer.md`, `…/T-DG4-BE-R4-evidence/**` | This handback, its logs and the A/B transcripts |

**No migration.** None was needed. **No contract change:** `docs/api/openapi.yaml` is untouched, so the operation count stays 652. The `contract.test.ts` media-type pin is unchanged, because all three operations are GETs with no body.

## 2. Behaviour delivered

### API endpoints added

| Operation | Method and path | Permission | Answers |
|---|---|---|---|
| `getInitiativeSchedule` | `GET /api/v1/initiatives/{initiativeId}/schedule` | `transformation.read` | 200 `InitiativeSchedule` + `ETag`; 404 unknown initiative, outside scope or no row; 400; 401 |
| `listScaleScopeBusinessUnits` | `GET /api/v1/transformations/{transformationId}/scale-scope/business-units?cursor&limit` | `transformation.read` | 200 `ScaleScopeBusinessUnitPage`; 404 outside scope; 400 (bad query or foreign cursor); 401 |
| `getAssessmentFormVersion` | `GET /api/v1/transformations/{transformationId}/assessment-forms/{assessmentFormId}/versions/{versionNo}` | `transformation.read` | 200 `AssessmentFormVersion`, no `ETag`; 404 no such form in this transformation, no such version, or outside scope; 400; 401 |

All three are read-only. They write nothing, so there is no audit event, no `If-Match` and no transaction. The tests check that the audit trail is unchanged by the reads.

### Item 1. `getInitiativeSchedule` (ADR-0031 amendment S1)

- **Read gate:** the same as the POST and PATCH. Look up the initiative (404 when absent), then `requireTransformationRead` (404 outside scope, so an ADM-only user gets 404). Then the `initiative_schedule` row by `initiative_id`: none → `problems.notFound()`, else `sendVersioned(reply, 200, toInitiativeSchedule(row))`.
- **Proven (`initiative-schedule-read.test.ts`, the be-e exercise):**
  - 200 with the created row and `ETag: "1"`, for TL, FIN, BO and AUD;
  - the create's `Location` now resolves;
  - the read's `ETag`, sent as `If-Match`, is accepted by `updateInitiativeSchedule`. After it, the read answers `"2"` with the PATCH's body, and a stale `If-Match: "1"` gets 409 with `currentVersion: 2`;
  - a row whose duration is null answers 200 with `durationWorkingDays: null`;
  - 404 `urn:mth:problem:not-found` for a readable initiative with no row, for an unknown initiative, for ADM-only and for another organization's officer. All four bodies are identical, so they disclose nothing;
  - 400 for a malformed id, and 401 unauthenticated;
  - the reads add no audit event.
- **Row REQ-S09-009** (acceptance: "A05: for a fixture network the computed critical path matches the expected chain; with missing durations no critical path is claimed"). The read changes neither the network nor its computation. The be-e exercise still asserts the computed path `[[a, b]]` with P = 14 after the reads. The new no-row 404 check runs after the network assertion, because an initiative without a duration would make the network `not_computable`, which is exactly what this acceptance text requires.

### Item 2. `listScaleScopeBusinessUnits` (ADR-0035 amendment R1)

- **Rows:** `business_unit` joined to the transformation on `organization_id`, where `status = 'active'` OR the id is in the `business_unit_id`s of this transformation's `gate_decision_scale_scope` rows OR of its `scale_transition` rows.
- **Members:** `{ id, code, nameEn, nameAr, status, selectable: status === 'active' }`.
- **Order and paging:** `code`, then `id`, with the `listBusinessUnits` cursor pattern (`(b.code, b.id) > (…)`; filter hash bound to the transformation).
- **Proven (`scale-scope-business-units.test.ts`, the be-k exercise):**
  - **"a Sponsor with only a transformation grant sees every active unit of the organization, and no unit of another organization":** the Sponsor's only grant is checked to be transformation-scoped. The body equals exactly the organization's active units, in code/id order, with exactly the six members. BU `b1` of org B is absent;
  - **"a unit set to inactive after an approved scope named it is listed with `selectable: false`":** a G5 approval names BU `a2`. `a2` is then set `inactive` through the DG1 route. It is listed with `status: inactive, selectable: false`;
  - **"an inactive unit that no scope names is not listed":** `a1x`, set inactive, is absent. Another transformation of the same organization, whose scope names nothing, sees only the active units;
  - **paging:** `limit=1` walks exactly the full list. A cursor from another transformation answers 400;
  - **"an outsider gets 404":** another organization's officer and ADM-only both get 404. Unauthenticated gets 401.
- **Row REQ-S04-007** (acceptance: "A02;A08: G5 submission with an open material risk lacking resolution or approved disposition is rejected; an approval records the scale scope and later scaling outside it is blocked"). Unchanged and still proven by BE-K's tests (`scale.test.ts`, the be-k exercise, both passing). This read lets the default approver list the units that scope may name.

### Item 3. `getAssessmentFormVersion` (ADR-0033 amendment V1)

- **Read:** `requireTransformationRead`, then `assessment_form_version` joined to `assessment_form` on the form id, with `f.transformation_id` equal to the path's transformation and `v.version_no` equal to the path's. None → 404. Answer: 200 `AssessmentFormVersion`, with no `ETag`.
- **`versionNo` parsing:** the charter precedent (`z.coerce.number().int().min(1)`), plus `max(2147483647)`, because the column is a PostgreSQL integer. A larger value is a 400, not a database error.
- **Proven (`assessment-form-version.test.ts`, the be-h exercise):**
  - **"version 1 after an update to version 2 returns the old questions":** after a PATCH with new questions, version 1 returns the original `V1` schema with its creator and creation instant, and version 2 returns the new one. Neither has an `ETag`, and the body has exactly the four members;
  - an unpublished version (version 1 of a draft, and version 2 before republishing) is readable, and so are both versions of a retired form;
  - **"version 99 gives 404";**
  - **"a form of another transformation gives 404":** through this transformation's path, by an org-level auditor who can read both transformations, so the path check (not scope) refuses it. An unknown form gives 404, as do ADM-only users and another transformation's TL;
  - `versionNo` `0`, `-1`, `1.5`, `x` and `2147483648` give 400 `validation`. Unauthenticated gets 401;
  - the reads add no audit event.
- **Rows REQ-S11-002** (acceptance: "A11: a proficiency observation submitted via the form links to the stakeholder group and counts in the proficiency indicator") **and REQ-S16-020** (acceptance: "A11: … an integration test creates and reads each one through the API with authorization enforced"). The form and record behaviour is unchanged (BE-H2's `assessment-forms.test.ts` and `assessment-records.test.ts` pass in the full suite). The new read adds an authorized read path for the form version a record was answered on.

### Item 4. `Problem.params` (ADR-0038 amendment Q1)

- `ProblemDetails.params?` (`Readonly<Record<string, string | number | boolean | null>>`). The zod mirror gains `params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional()`. `HttpProblem` gains `params`, and `toBody` appends it after `currentVersion`, only when it is defined.
- `gates.ts`: the two refusals are built by a local `modularWaiverRefusal(code, detail, date)`. It has exactly the members of `problems.businessRule` (422, `urn:mth:problem:validation`, "Business rule violated", code, detail) plus `params: { date }`. The date is the same value interpolated into `detail`: `p4_business_date(revoked_at, timezone)` for revoked, `expires_on` for expired.
- **Proven (`modular-waiver.test.ts`, the Q1 `describe`):**
  - **"both refusals carry `params.date` equal to the date in `detail`":** the exact body. Its keys, in order, are `type, title, status, detail, code, requestId, params`; `detail` contains ` <date>;`;
  - **"a contract-test response validates against `Problem`":** each body validates against the OpenAPI `Problem` component (`matchesComponent`) and round-trips through the zod mirror unchanged;
  - the G3 submission refusal `gate.modular_links_missing` has no `params`;
  - **"Every existing problem assertion passes unchanged":** no existing test line was edited, and the full unit and integration suites pass (§3). The byte-level proof is below.
- **Row REQ-S03-005** (acceptance: "A03: entering at Design with an inherited G2 approval document shows G2 as 'inherited' (not Approved); a missing baseline and outcome link are flagged and G3 submission is rejected until supplied or waived"). Unchanged and still proven by BE-R3's and BE-M2's tests. The refusal now carries the date the web needs to show it in both languages (S-6).

### Item 5. `forumAr` (ADR-0032 amendment G3, ADR-0025 amendment L1)

- `minutesTask` selects `["name_en", "name_ar"]` and passes `messageParams: { forum: name_en, forumAr: name_ar, meetingDate }`. `forum` and `meetingDate` are unchanged. `reassignWorkItemOfSubject` is unchanged, so an open item keeps the params it was created with (as G3 states).
- **Proven (`minutes.test.ts`):** "The test asserts both names on a new item." Through My Work (`GET /api/v1/me/work-items?kind=minutes_to_approve&status=open`), the new item's `messageParams` equals `{ forum: <forum.name_en>, forumAr: <forum.name_ar>, meetingDate: <the meeting's scheduledDate> }`, with the two names read from the database and checked to differ.

### Byte stability (the BE-M2 response-transcript method)

- **Method** (`evidence/ab/ab-commands.sh`, output `evidence/ab/ab-result.txt`):
  - **"after"** is this tree;
  - **"before"** is the same tree with the six API source files I changed replaced by `git show HEAD:<file>`. My files were restored afterwards and verified with `sha256sum -c` (all six `OK`);
  - both sides run the same test files with the same `-t` filter, which selects only tests that hold on both sides: BE-R3's four transcript tests, BE-M2's End-to-End gate transcript, my refusal transcript, and my touched-modules transcript;
  - **both runs:** 5 files, 15 passed, 28 skipped by the filter, exit 0 (`evidence/ab/ab-run-after.log`, `ab-run-before.log`);
  - the normalizer (`response-transcript.ts`) replaces ids, instants, 64-hex hashes and the BE-M2 fixture names, and keeps every other byte;
  - the `@mth/shared` package resolves to source in Vitest (`@mth/source` condition), so no rebuild was needed between the sides.
- **Results (`cmp`):**

| Transcript | What it covers | Lines | Result |
|---|---|---|---|
| `dispensations` | BE-R3's DG3 dispensation responses (create, decide, revoke, list, inherited approvals, readiness, gate list and view, every refusal) | 58 | **BYTE-IDENTICAL**, sha256 `d48aa63d67cce9201484aaaa0039ddab734038a9df4acd0b9e33046b75baecec`, the same hash BE-R3 recorded |
| `modular-refusals` | BE-R3's Modular dispensation refusals and list | 6 | **BYTE-IDENTICAL**, `59d0fdb4f7445ec41a755b8365355ccd8e7932f7560165ab5d6b8b07ed4ca563`, the same as BE-R3 |
| `meeting-action` | BE-R3's meeting-action rows, audit and work items | 8 | **BYTE-IDENTICAL**, `c0998f6aee074e31ce819bf8c39a37b64d2578b21a3505ba2a04c0ecfb9e3e49`, the same as BE-R3 |
| `e2e-gates` | BE-M2's 21 End-to-End G1–G4 gate responses | 21 | **BYTE-IDENTICAL**, `be4f2daad11ae8acfecab410afd9c96db3a29982be2493e8914e2d21c0d28768`, the same as BE-M2 and BE-R3 |
| `waiver-refusals` | The G3 submission refusal, and the revoked and expired approval refusals | 3 | **Differs in exactly the 2 refusal lines, by the added `,"params":{"date":"…"}`** (`evidence/ab/waiver-refusals.diff`). The submission refusal is identical |
| `touched-modules` | 37 responses of existing operations: schedule create, update, network and execution with 400, 401, 403, 404, 409 (duplicate and version) and 428 problems; scale scope, transitions (422 ×2, 409) and the gate list and G5 view after a G5 approval; assessment forms (400 schema, create, read, list, publish, new version, 409, 404, 403); minutes create, the chair's My Work list and a 428 | 37 | **Differs in exactly 1 line, the My Work item, by the added `"forumAr":"مراجعة التحول"`** (`evidence/ab/touched-modules.diff`) |

- **After removing only those two members** from the "after" files (`sed` in `ab-commands.sh`), all six transcripts are **BYTE-IDENTICAL** to "before".
- **Conclusion:** every existing response I recorded is byte-identical, except the added `params` member on the two refusals and the added `forumAr` message parameter.
- **Not recorded:** the three new GETs, which had no route on the base.

## 3. Checks actually run

Environment: Node 24.21.0, offline, PostgreSQL from `tests/qa/support/with-pg.sh` (disposable cluster, UTF8, C locale), ports 25950–25999.

| Check | Command | Exit | Result / log |
|---|---|---|---|
| Historical DG3, start | `node tools/gates/validate.mjs --historical --stage DG3` | 0 | `PASS gate DG3 (historical)` (`validate-dg3-historical-start.log`) |
| Typecheck | `pnpm -r typecheck` | 0 | `typecheck.log`. The first run exited 2, see §4 |
| Build | `pnpm -r build` | 0 | `build.log` |
| Lint | `pnpm lint` | 0 | `lint.log` (`eslint . --max-warnings=0`) |
| Format | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `prettier.log`. Re-run at the end with the handback present: §6 |
| OpenAPI | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 652 operations` (`openapi-lint.log`) |
| Unit, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | first invocation 143 files, **2719 passed**; second invocation 3 files, **259 passed, 2 skipped** (`unit-locale-unset.log`) |
| Unit, `C.UTF-8` | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | **2719 passed**; **259 passed, 2 skipped** (`unit-c-utf8.log`) |
| Integration | `QA_PG_PORT=25950 MTH_PORT_POOL=25951-25999 tests/qa/support/with-pg.sh pnpm test:integration` | **1** | 194 files: 193 passed, 1 failed; **1849 passed, 1 failed** (1850), 1750.8 s. The one failure is the pre-existing `benefits-queue.test.ts` timeout that D-114 assigned to KBE-R4 (§4 item 4) (`integration.log`) |
| Targeted integration | `… with-pg.sh pnpm vitest run --project integration <the 5 behaviour test files>` | 0 | 5 files, 31 passed (`earlier-runs/targeted-1.log`) |
| Contract test | `… with-pg.sh pnpm vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | 0 | 45 passed (`earlier-runs/contract-1.log`) |
| A/B byte identity | `bash evidence/ab/ab-commands.sh` | 0 / 0 | §2 table (`ab/ab-result.txt`, `ab/ab-run-*.log`, `ab/*.jsonl`, `ab/*.diff`) |
| Historical DG3, end | `node tools/gates/validate.mjs --historical --stage DG3` | 0 | `validate-dg3-historical-end.log` |

- **Pinned counts:** the contract operation count stays 652, and the media-type pin is unchanged. The unit counts equal D-114's (2719 and 259/2). Integration: D-114 recorded 1831/1832. This run has 1849/1850: the same single failure, plus my 18 new tests (4 + 3 + 2 behaviour tests, 3 Q1 tests + 1 refusal transcript, 1 minutes test, 4 touched-module transcript tests). No existing test was removed, skipped or changed.
- **Production wiring (D-107):** every new route is reached on the real server that `startApi()` builds with the production `buildServer` (`apps/api/src/server.ts`), with nothing registered by hand: `contract.test.ts` through the validating client, and my three behaviour files directly. The contract test's "covers every operation with at least one success and every successful body with its zod mirror" passes with the pending list empty.

## 4. Non-zero exits, failures and reruns (disclosed)

1. **First `pnpm -r typecheck`: exit 2** (`earlier-runs/typecheck-1.log`). 11 errors, all in my new `initiative-schedule-read.test.ts`: its `Caller`-typed sender returns `unknown` bodies. I switched to the `call<Body>` idiom that `minutes.test.ts` uses. The re-run exited 0. `pnpm lint` had passed before the fix and passed again after it.
2. **First transcript trial run: exit 1.** One failure, `expected 409 to be 200`, in my own new transcript test. My fixture guessed the form's `If-Match` after publish (`"2"`), but publish had moved it further. It now uses the version that publish returns. The second trial passed 4/4 (`earlier-runs/transcript-trial-2.log`). The first trial's log was overwritten, and its transcript was discarded. The A/B runs in §2 were made after the fix.
3. **A wait command timed out.** A shell loop that polled `integration.log` hit the 600 s tool limit and moved to the background. It only reads the log and does not affect the run.
4. **Full integration: exit 1, 1849/1850.** The one failure is `apps/worker/test/integration/benefits-queue.test.ts` › "one queue item; a redelivery and a restarted worker write no second item": `waitFor: timed out` at line 109. It is the same test, failing at the same line, that D-114 recorded at `0a3da46` and assigned to KBE-R4 for root cause ("the merged tree is not green until then").
   - It is in `apps/worker` and tests the benefits Finance queue. I changed no worker file, no outbox or job code, and nothing it reads.
   - Run alone on this tree, it passes 2/2, exit 0 (`benefits-queue-alone.log`), the same pattern D-114 describes.
   - I did not raise its timeout or skip it. **So acceptance item 3 ("`pnpm test:integration` passes") is not met on this tree, because of that pre-existing failure.** Every other integration test passes, including all of mine.

## 5. Operations routed (delta to my pending list), and needs for the orchestrator

**`apps/api/test/support/p4-pending-arch-r3.ts`: 3 → 0.**

| Operation | Removed | Routed in | Exercised in |
|---|---|---|---|
| `getInitiativeSchedule` | yes | `apps/api/src/modules/portfolio/schedule-network.ts` | `p4-exercises-be-e.ts` |
| `listScaleScopeBusinessUnits` | yes | `apps/api/src/modules/workflows/scale.ts` | `p4-exercises-be-k.ts` |
| `getAssessmentFormVersion` | yes | `apps/api/src/modules/adoption/assessments.ts` | `p4-exercises-be-h.ts` |

**Contract and schema needs:**

- **No contract change needed.** The implementation follows `openapi.yaml` as ARCH-R3 left it, and the contract test validates every new response against it.
- **One file outside the list in ARCH-R3 §6:** `packages/shared/src/schemas/gates-p4.ts` (the BE-K zod mirrors file, a backend-workflow-engineer file). I added the zod mirror of `ScaleScopeBusinessUnit` and `ScaleScopeBusinessUnitPage` there, because ARCH-R3 added the schemas to the contract but not to the mirrors, and the contract test needs a mirror per exercised operation. The change is additive (two exports), and the web can import the type.
- **For FE-R3 (ADR-0038 Q1, ADR-0032 G3, ADR-0031 S1, ADR-0035 R1, ADR-0033 V1):** all five server sides now exist. `problem.params.date` is sent only on the two codes. `forumAr` is present only on minutes items created after this change. An item created earlier renders with the English name, as G3 states.
- **For the orchestrator, from ARCH-R3 §6 FE-R3 item 4 (unchanged by me):** the FE ADR-table guard does not read amendment tables.

## 6. What remains, end checks and merge instructions

- **What remains:**
  - **In my section:** nothing. Items 1–5 are implemented and tested, and the pending list is empty.
  - **Outside it:** the full integration suite is green only once KBE-R4 fixes `benefits-queue.test.ts` (D-114). Until then, acceptance item 3 is not met on this tree (§4 item 4).
- **End:** `Sat Oct 10 13:57:21 UTC 2026` (`date -u`; `evidence/end-time.txt`). After it, the whole-tree format check was re-run with this handback and the evidence present: exit 0 (`prettier-final.log`).
- **Merge instructions:**
  - **No migration.** Apply nothing.
  - **Conflicts to expect:**
    - KBE-R4 also implements ARCH-R3 (the drill-down `valueClass`, lineage). It may touch `contract.test.ts` comments or the shared schemas index, but I edited neither;
    - `p4-exercises-be-{e,h,k}.ts`, `modular-waiver.test.ts` and `minutes.test.ts` are append-only changes. Two lines were also extended: the mirror maps and the imports;
    - `gates.ts` changed only in the two refusal constructors (lines around 1457–1480).
  - **Ordering:** FE-R3's items that depend on BE-R4 can start once this is merged.
