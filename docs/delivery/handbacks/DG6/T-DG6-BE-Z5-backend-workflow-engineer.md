# Handback T-DG6-BE-Z5 (backend-workflow-engineer): a sensitive benefit's identity and values through derived read paths (F-DG6-300, F-DG6-280)

- **Stage / gate:** P6, DG6 (FIXING after review round 4).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-Z5-backend-workflow-engineer-20261105T070926Z-571a1d64","session_id":"571a1d64-f3fb-4e5a-a33c-566b9a2ab217"}`
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-Z5.md` (sha256 `fe942e89…ab9add4aa`, verified at start).
- **Base:** branch `dg6/be-z5` at `c563194115f9de9fe9dae252834cb1582df45b31`, clean tree. Changes are left **uncommitted**.
- **Time:** start `2026-11-05T07:09:43Z` (`date -u`), end `2026-11-05T08:38:52Z` (`date -u`), within the 2-hour limit.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, **exit 0** (run before any change).
- **Migrations:** none. **New dependencies:** none. **Contract (`openapi.yaml`) changes:** none (see §6).
- Every value in the tests is SYNTHETIC. Marking a record sensitive or granting access is an access decision, not a business approval (G1–G6). No G1–G6 approval was granted, and nothing here implies DG7.

All three items are done, including the separable second half (item 2).

## 1. The class, and how it is fixed

Each leak has the same cause. A read model takes no principal, so it copies a sensitive benefit's code, title or values into a response that every transformation reader can see. For F-DG6-280, the worker copies them into a record that every transformation reader can see.

This change does two things:

1. **Every derived read named in the findings is fixed.** The fix applies the existing single helper `access/sensitive-reach.ts` (`restrictedRecordRefs` / `withoutRestricted`) to the reader, at the point where the derived view leaves the API. For reports, one function, `reporting/reports/restricted.ts`, covers **every** report definition: the live report, every snapshot response and the snapshot sub-lists. It does not patch the registers assembler alone.
2. **A sweep test guards the class.** `sensitive-reach-sweep.test.ts` calls every fillable GET operation of the contract: 375 of the 446 GET operations, expanded to 418 requests per reader. It calls each one as an admitted reader and as two readers who are not admitted. It fails on any title, `<code> <title>` or planned-value leak.

## 2. Behaviour delivered per route (ADR-0051 §2 as amended on 2026-11-04)

"Not admitted" means a reader who gets 404 on the benefit: TL, AUD or BO2 without a grant who is not a named party.

**Traceability graph** (`getTraceability`, `reporting/traceability.ts`)
- **Rule:** OMIT. The reader gets no node and no edge that touches the benefit. Node count and `truncated` are computed without it.
- **Why:** omission keeps the graph truthful. The orphan flags and allocation totals of the other nodes are still computed over **all** edges, so a KPI that feeds only the restricted benefit is not shown as an orphan. A root that names the benefit is refused exactly like an unknown root (422 `trace_link.record_not_found`, the same status and code).

**Trace links** (`listTraceLinks`, `getTraceLink`, `PATCH`, `/remove`)
- **Rule:** OMIT from the list, and 404 on the item and write routes.
- **Why:** a `kpi_benefit` link carries the benefit's id, contribution statement and allocation share. `trace_link` is added to `SENSITIVE_CHILD_SOURCES` (`benefit_id`), and `traceLinkId` is added to `SENSITIVE_REACH_PARAMS`. This follows the ADR-0051 amendment rule "a new table that carries a sensitive record's value must be added".

**Allocation set of the benefit** (`getAllocationSet` with `benefit`)
- **Rule:** 404.
- **Why:** it answers the same as the benefit's own GET.

**Missing links** (`getMissingLinks`, `reporting/modular.ts`)
- **Rule:** OMIT the benefit's `benefit_outcome_link_missing` item, with no placeholder and no count.
- **Why:** the item is a **warning**, and no verdict reads it. The Modular G3 precondition reads only blocking items, and none of them names a benefit. `benefit_missing` is still decided over every active benefit, so the report never claims "no benefit" while one exists. That keeps it truthful, and it names no record.

**G6 readiness** (`getGate` G6, submission 422, frozen submission text; `workflows/g6.ts`, `benefits/gate-facts.ts`)
- **Rule:** a NEUTRAL PLACEHOLDER: "Benefits evidence: a restricted benefit has no Finance-validated measurement and no approved transition decision." It has no code, title, id or pointer, and every reader sees the same text.
- **Why:**
  - The item must stay: it blocks submission, so the verdict and the count stay truthful.
  - The text is the same for every reader because it is frozen into the submission snapshot and into the 422 refusal, which readers outside the grant see.
  - The fact loader marks `sensitive` from `record_sensitivity`, which is not reader-dependent.

**Live report** (`getLiveReport`, every definition)
- **Rule:** OMIT the restricted rows and list items, and their section sources. The subject of a sensitive business case answers 404.
- **Why:** `documentForReader` is applied per reader. Table totals and metrics stay exactly as in DG4/DG5 (D-195 Q3: an aggregate is computed identically and never shows the individual value).

**Stored snapshot** (`getReportSnapshot`, and the bodies returned by `generate`, `issue`, `discard` and `reissue`)
- **Rule:** OMIT, as for the live report, at read time.
- **Why:** the stored row is never rewritten (its `contentSha256` stays the hash of what was stored). A snapshot generated by an **admitted** user therefore shows the restricted rows to admitted readers only. A snapshot generated by a reader who is not admitted shows them to admitted readers only as well. The not-admitted generator's own 201 body holds no restricted row.

**Snapshot sub-lists** (`/sources`, `/evidence`, `/versions`) and the snapshot list
- **Rule:** OMIT restricted sources and evidence. For a snapshot whose subject is a restricted business case, the snapshot and its sub-lists answer 404 and the list omits it.
- **Why:** these are the same refs as the snapshot.

**Export of such a snapshot**
- **Rule:** unchanged: 403 `export.includes_restricted_records` (D-199).
- **Why:** the tests assert it is still refused.

**Change-impact preview** (`previewChangeImpact`, `getChangeRequestImpactPreview`; `workflows/impact.ts`)
- **Rule:** OMIT the item, and count it in `hiddenItemCount`.
- **Why:** this is the contract's own field: "counts affected records outside the caller's scope (never shown as 'no impact')". The verdict stays truthful, and no code or title is shown.

**Frozen impact assessments** (`listImpactAssessments`, `getImpactAssessment`)
- **Rule:** OMIT the item from `items` at read time.
- **Why:** `itemCount` and `contentSha256` stay those of the frozen assessment. They are the truthful size of the change's impact, and they name no record.

**Blocker statuses** (`listBlockerStatuses`)
- **Rule:** OMIT a status that names a restricted blocker. The list filters after pagination and returns no count.
- **Why:** the row names the case.

**Item 2, F-DG6-280**, both ends:
- **Producer** (`apps/worker/src/handlers/raid.ts`, `handleBenefitVariance`): when the benefit is marked sensitive, the case title is the case's **own code** (`CA-nn`) and no longer `benefit.title`. A code is language-neutral and consistent with the file's "S-6: user data, not a system sentence" rule. An unmarked benefit keeps the DG4 behaviour (`raid-corrective.test.ts` is unchanged and passes).
- **Copier** (`apps/worker/src/handlers/escalations.ts`, `blockerName`): the ask of a corrective case that **belongs to a benefit** is titled by the case code only, never by the case title. This applies **whether or not the benefit is sensitive now**, because a benefit can be marked after its ask exists and the ask's title is never rewritten. That case is tested: a case opened before marking still carries the benefit's title. Every copy the ask makes follows from its title: `decision.title`, the owner's notification `messageParams.title`, and the search document of the ask, which indexes the title.
- **Blocker status naming a case the caller cannot read** (judged as the assignment asks):
  - **Decision:** refused, with the answer for an **unknown id**: 422 `blocker_status.record_not_found`. The body is byte-identical apart from the request id.
  - **Why not a bare 404:** in this route 404 means "meeting not found", and an unknown blocker is already 422. A different answer would disclose that the case exists.
  - **Where the rule lives:** `governance/blocker-escalation.ts` `blockerExists` now takes the principal and treats a restricted blocker as absent. `createExecutiveDecision`'s blocker link uses the same function, so a person outside the grant cannot link an ask to the case either.
  - **Why it matters:** this also removes the trigger. Only someone admitted can record the case as red, so only an admitted person can start the escalation.

## 3. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/access/sensitive-reach.ts` | `trace_link` child source; `traceLinkId` reach parameter |
| `apps/api/src/modules/reporting/traceability.ts` | per-reader graph (omit node and edges; truthful flags); trace-link list filter; benefit allocation set 404; exported `restrictedBenefitIds` |
| `apps/api/src/modules/reporting/modular.ts` | per-reader missing links (omit the restricted benefit's warning) |
| `apps/api/src/modules/reporting/reports/restricted.ts` (new) | `documentForReader`, `snapshotForReader`, `visibleRefs`: per-reader report documents |
| `apps/api/src/modules/reporting/reports/routes.ts` | applies them to live, generate, snapshot GET/list/sources/evidence/versions, issue, discard, reissue |
| `apps/api/src/modules/benefits/gate-facts.ts` | `sensitive` fact from `record_sensitivity` |
| `apps/api/src/modules/workflows/g4.ts` | `BenefitEvidenceFact.sensitive?` |
| `apps/api/src/modules/workflows/g6.ts` | neutral G6 readiness item for a sensitive benefit |
| `apps/api/src/modules/workflows/impact.ts` | per-reader impact preview (`hiddenItemCount`) and assessments |
| `apps/api/src/modules/governance/blocker-escalation.ts` | `blockerExists(db, principal, …)`: a restricted blocker is absent |
| `apps/api/src/modules/governance/escalations.ts` | blocker-status create refuses a restricted blocker; the list omits its statuses |
| `apps/api/src/modules/governance/executive-decisions.ts` | blocker link uses the principal-aware check |
| `apps/worker/src/handlers/raid.ts` | a sensitive benefit's variance case is titled by its own code |
| `apps/worker/src/handlers/escalations.ts` | the ask of a benefit's corrective case is titled by the case code (`benefitCaseAskTitle`) |
| `apps/api/test/integration/access/sensitive-reach-sweep.test.ts` (new) | item 3: the class sweep (demo dataset) |
| `apps/api/test/integration/access/sensitive-reach-derived.test.ts` (new) | ports `zz-cs-r4-sens-title` and `title2`: traceability, trace links, allocation set, missing links, G6, live report, snapshots (by admitted and by not-admitted generator), export refusal |
| `apps/api/test/integration/access/sensitive-reach-escalation.test.ts` (new) | ports `dom-r4-sensitive-escalation`: consumer title, blocker-status and ask-link refusal, ask, inbox, status list, with negative and positive cases |
| `apps/api/test/integration/access/sensitive-reach-impact.test.ts` (new) | impact preview (draft and saved) and frozen assessments |

## 4. Tests (positive and negative), and that they fail before the fix

**Sweep (`sensitive-reach-sweep.test.ts`)** runs against a real `seedDemo` database.

Setup:
- Benefit B01 gets a unique title and planned value `7654321.1234`, with its audit event.
- The real worker consumer opens its variance case while it still carries the title.
- A TO marks the benefit sensitive and grants a second TL.
- The admitted TL runs two red review cycles, and the real `handleBlockerEscalation` creates the ask and its notification.
- The admitted TL generates two register snapshots.

What the sweep does:
- It covers every GET operation of `docs/api/openapi.yaml` whose path parameters can be filled. Each `{xId}` is filled from its table, with the row of the sensitive benefit first. The gate codes G1–G6 and all report definition codes are expanded, and `snapshotId`, `correctiveCaseId`, `meetingId` and `decisionId` come from the setup.
- It adds the six live registers reports, `searchRecords`, and `listMyInbox`.

Result:
- 418 requests per reader, covering 375 distinct operations, with a floor of 330 in the test.
- **Negative:** TL and AUD receive the title, `<code> <title>` or `7654321.1234` in **no** response.
- **Positive:** the admitted TL sees the title on `getBenefit`, `listBenefits`, `getTraceability`, the live benefits register and `getReportSnapshot`.
- 71 operations cannot be filled from the seeded data, because the demo has no such rows or the parameter is a string key. The test logs them by name.

**Pre-fix run** (`01-new-tests-BEFORE-fix.log`): the four new files ran with the source diff reverse-applied, then re-applied.
- **Sweep:** 1 of 2 tests failed.
- **Impact:** 2 of 3 failed.
- **Escalation:** 3 of 4 failed.
- **Derived:** the suite failed in `beforeAll` (all 5 tests skipped). Its first assertion was that a not-admitted TL's own `generate` response holds no restricted row, and the unfixed code returns the row.
- **Total:** exit 1, 6 failed, 3 passed, 5 skipped.
- The earlier sweep-only run on the unfixed tree listed the leaks by route: `getTraceability`, `getReportSnapshot` and `getLiveReport(registers: benefits)`, for both TL and AUD. These were the routes of F-DG6-300 that the demo data reaches.

## 5. Checks actually run (logs in `docs/delivery/handbacks/DG6/T-DG6-BE-Z5-evidence/`)

Environment: Node 24.21.0, offline, disposable PostgreSQL 16.15 through `tests/qa/support/with-pg.sh`, ports 30001–30004 inside `MTH_PORT_POOL=30000-30049`.

| Check | Command | Result |
|---|---|---|
| DG5 historical | `node tools/gates/validate.mjs --historical --stage DG5` | PASS, exit 0 |
| New tests, BEFORE fix | `with-pg.sh npx vitest run --configLoader runner --project integration <4 new files>` (source diff reverse-applied) | exit 1: 6 failed, 3 passed, 5 skipped (intended red) (`01-new-tests-BEFORE-fix.log`) |
| Touched integration suites | same runner over 64 files: `apps/api/test/integration/access/*` (the sensitive-reach and access suites, including the 4 new files), reporting `traceability`, `modular`, `registers-report`, `report-snapshots`, `impact`, `allocation`, `orphans`, `kbe-c2`/`kbe-d2` assemblers, `exports`, `report-synthetic`, `table-totals-demo`, `gates.test.ts`, `gates/`, workflows `g5-g6`, `impact`, `change-requests`, `modular-precondition`, all of `governance/` (executive decisions, escalation rules, blocker status, meetings, presentation, …), tasks `deep-links`, `work-items` (inbox), all of `raid/`, worker `raid-corrective`, `blocker-escalation`, `decision-sla-escalation`, qa `a12-p6-scope-isolation`, `a09-decision-escalation`, `a15-snapshots-and-packs` | **exit 0: 64 files, 566 passed, 1 skipped** (`02-touched-suites.log`). The skip is the pre-existing `it.runIf(hasMeetingPackAssembler)` in `governance/presentation.test.ts` (file unchanged). |
| New and key tests, final tree | same runner over the 4 new files plus `sensitive-reach`, `sensitive-reach-registers`, `report-snapshots`, `traceability`, worker `blocker-escalation`, `raid-corrective` | **exit 0: 10 files, 63 passed**; the sweep made 418 requests per reader (`03-new-and-key-suites-final.log`) |
| typecheck | `pnpm -r typecheck` | exit 0 (`10-typecheck.log`) |
| build | `pnpm -r build` | exit 0 (`11-build.log`) |
| lint | `pnpm lint` | exit 0 (`12-lint.log`) |
| format | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | first run **exit 123**: two of my files were not formatted (`13a-prettier-first-run-exit123.log`). After `prettier --write` on my files, the rerun exits 0 (`13-prettier.log`). |
| openapi | `pnpm openapi:lint` | exit 0, 932 operations (`14-openapi-lint.log`) |
| unit, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE pnpm test` | first run **exit 1**: 2 failures, both the module-boundary test (`architecture.test.ts`, `reporting.test.ts`), which rejects `refs[i]` (computed member) in my new `restricted.ts` (`20a-…-first-run-exit1.log`). After rewriting it without the index access, the rerun **exits 0**: unit-node 190 files / 2899 tests, unit-web 120 / 2039, unit-formula-nocodegen 3 files / 259 passed, 2 skipped (`20-pnpm-test-locale-unset.log`). |
| unit, C.UTF-8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **exit 0**: unit-node 190 files / 2899 tests, unit-web 120 / 2039, unit-formula-nocodegen 3 files / 259 passed, 2 skipped (`21-pnpm-test-C.UTF-8.log`). This run did not finish within the tool's 600 s foreground limit. The tool moved it to the background, where it completed with exit 0. |

The full `pnpm test:integration` was not run, as the assignment says. The orchestrator runs it on the merged tree.

## 6. Contract, schema and dependency needs (for the orchestrator)

- **No contract change is needed for what ships.** Every response keeps its shape:
  - rows, items, nodes and edges are omitted;
  - the G6 item is a normal `Warning` without `pointer`;
  - `hiddenItemCount` already exists.
- **Optional need:** `ReportDocument` (content schema version 1, strict) has no `includesRestrictedRecords` member. A report table whose total includes an omitted restricted row therefore carries no "Includes restricted records" label, as the dashboards and benefit totals do (D-195 Q3). Adding the member would be an additive optional property on `ReportDocument` (and on its zod mirror `packages/shared/src/schemas/report.ts`), set by `documentForReader`. That is for the architect and orchestrator to decide. I did not add it, because it changes the content schema of stored snapshots.
- **No migration and no dependency.**

## 7. Operations routed (pending-list delta)

None. No operation was added or moved. Every touched route already existed and was exercised. `contract.test.ts` is part of unit-node, which passes.

## 8. User-facing texts

- **G6 readiness, server English text:** "Benefits evidence: a restricted benefit has no Finance-validated measurement and no approved transition decision." This is the API's message string. The web shows its own catalogue text for `g6.benefit_not_validated` (`apps/web/src/i18n/en/gates.json`: "Benefits evidence: a benefit has no Finance-validated measurement …"). That text is still true, so no en/ar string was made untrue.
- **Neutral titles:** the case and ask titles are now the case code (`CA-nn`). That is record data, not a sentence, so it needs no en/ar translation.
- **No string that calls a feature "planned" or "later" is affected.**

## 9. Final runs and end time

Order matters for one disclosure:
- The 64-file touched-suite run (`02-touched-suites.log`) ran **before** two final edits. One rewrote `visibleRefs` in `reports/restricted.ts` without index access (same behaviour), to satisfy the module-boundary unit test. The other was `prettier --write` on `governance/escalations.ts` and `workflows/impact.ts` (formatting only).
- After those edits, these all ran again on the final tree and pass:
  - typecheck, build, lint, format and openapi;
  - `pnpm test` in both locales;
  - the four new files with the key reporting, traceability, worker-escalation and corrective suites (`03-new-and-key-suites-final.log`: 10 files, 63 passed, exit 0).
- The other 54 files of the touched set were not re-run after those two edits.

End: `2026-11-05T08:38:52Z`.

## 10. What remains, residuals, merge notes

1. **Not swept, because the demo has no data:** 71 GET operations cannot be filled from the seeded data. The test logs them by name. Examples: TOM workshop, roadmap wave, budget line, owner update, restatement, import and connector items.
   - These are not benefit-derived views, except `getBenefitOverlap`, `getBenefitScenario` and `getTransitionDecision`.
   - Those three are already guarded per path parameter (`SENSITIVE_REACH_PARAMS`), with their own tests from BE-Y1, BE-Z3 and BE-Z4.
2. **Search index:** `searchRecords` is in the sweep, but the test does not run the worker's indexer, so the index is empty there. The ask's search document now indexes the neutral title. A corrective-case or benefit document is filtered by the search ReadScope (BE-B, not changed here).
3. **Frozen data from before this fix:** an ask or case created **before** this change keeps the benefit's title in its stored row. This change does not rewrite stored data. No such row exists in a released environment. If one must be handled, that is a data migration for the orchestrator to decide.
4. **Ids and codes:** the frozen G6 submission snapshot still lists benefit **ids** (no title or value). The round-3 domain reviewer accepted ids and codes in frozen G6 and closure snapshots. Action-register rows still show a restricted case's code (BE-Z4 residual), which is now also the ask's title. That is the case's code, not the benefit's.
5. **Count leaks I chose to keep (truthful verdicts):**
   - the G6 placeholder;
   - the impact preview `hiddenItemCount`, which the contract defines;
   - the frozen assessment `itemCount`;
   - report totals (D-195 Q3);
   - `benefit_missing`, which is decided over all benefits.
   None of them shows a code, title or value.
6. **Merge notes:**
   - no migration;
   - `blockerExists` has a new `principal` parameter, and both callers are updated;
   - `buildMissingLinks` and `previewOf`/`presentAssessments` in workflows also take a principal, and all callers are in the changed files;
   - conflicts are possible only with concurrent edits to `reporting/reports/routes.ts`, `reporting/traceability.ts` or `workflows/impact.ts`.
