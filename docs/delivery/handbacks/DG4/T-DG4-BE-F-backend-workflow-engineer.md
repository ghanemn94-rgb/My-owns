# Handback T-DG4-BE-F (backend-workflow-engineer): forums, participants, meeting series and generation, meetings

- **Stage / gate:** P4, DG4 (BUILDING). **Task:** T-DG4-BE-F, `docs/architecture/p4-work-split.md` §D.1.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-BE-F-backend-workflow-engineer-20261009T103335Z-76927014","session_id":"76927014-9816-419c-83b0-76173404030a"}`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-BE-F.md`, SHA-256 `48691941651afb6ef69107921f43ee0026996d146f3e5197f4a6e01a95a18e67` (verified with `sha256sum` before starting).
- **Base:** branch `dg4/be-f` at `b1d3b7fcfa8ce42c94edb68a8d4636fbbbc5c3fc`. The changes are **uncommitted**, for the orchestrator to integrate.
- **Time:** started `2026-10-09T10:33:55Z` (`date -u`); finished at the time recorded in §6.
- **Gates:** product gates G1–G6 are business approvals inside the product. Nothing here reads or writes DG0–DG7, and no meeting, job or seed approves anything. All test data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/shared/src/governance/recurrence.ts` (new) | Pure recurrence library: nominal daily, weekly and monthly occurrences in a window; the three non-working-day rules over an injected `isWorkingDay`; Unknown without a calendar; the working-day agenda cut-off (`cutoffDateOf`). |
| `packages/shared/src/governance/recurrence.test.ts` (new) | 19 unit tests: weekly → fortnightly, monthly day 28, daily on a Sunday–Thursday week with a holiday, skip/keep/next_working_day, Unknown, cut-off. |
| `packages/shared/src/calc.ts` | One append-only export line for the recurrence library, after BE-E's line. |
| `packages/shared/src/schemas/governance-meetings.ts` (new) | Zod mirrors of `Forum`, `ForumSourceTexts`, `ForumCreate`/`Update`, `ForumParticipant(Create)`, `MeetingSeries(Create/Update/Result)`, `Meeting(Create/Update)`, the pages and the list queries. |
| `packages/shared/src/schemas/index.ts` | One export line for that file. |
| `apps/api/src/modules/governance/forums.ts` | `listForums`, `createForum`, `getForum`, `updateForum` (archive), `listForumParticipants`, `addForumParticipant`, `removeForumParticipant`; the B0093 source texts in `source`. Also the slice D write helper `requireGovernanceAction` (read gate 404, then a permission re-check on grants reloaded inside the transaction). |
| `apps/api/src/modules/governance/meetings.ts` | `listMeetings`, `createMeeting`, `getMeeting`, `updateMeeting`, `publishMeetingAgenda`, `startMeeting`, `closeMeeting`, `cancelMeeting`. Chair through `resolveParty`; the cut-off on the business calendar; `presentCount`/`quorumState` on read. Exports `nextForumDateProvider`, wired into BE-C's `setNextForumDateProvider` at registration. |
| `apps/api/src/modules/governance/meeting-series.ts` | `listMeetingSeries`, `createMeetingSeries`, `getMeetingSeries`, `updateMeetingSeries`, `endMeetingSeries`; the exported `generateSeriesMeetings(tx, seriesId, fromDate, actor)` and the ADR-0032 §2 future-only regeneration, both under the `meetingSeriesGeneration` lock (730238). |
| `apps/api/src/modules/platform/db-errors-p4-meetings.test.ts` (new) | Pure unit tests of the slice D database last lines added here (beside the other `db-errors*.test.ts` files, so it imports only its own module). |
| `apps/api/src/modules/platform/db-errors.ts` | New slice D block `mapP4GovernanceMeetingError` (forum, participant, series and meeting lines of ADR-0032 §11), and one call in `mapDatabaseGuardError`, placed **before** the generic `*_version_step` rule so that `meeting_series_rule_version_step` maps to 500 as the ADR says. |
| `apps/worker/src/handlers/meetings.ts` | `governance.meeting_series_generate`: one `runOnce` per active series and business day, under lock 730238. It inserts `worker` meetings (audit actor `service`), advances `generated_through`, and without a calendar sends one inbox notice to the series author. |
| `apps/worker/src/queues/meetings.ts` | The queue spec `governance.meeting_series_generate` (standard retry policy and dead-letter queue). There is no outbox event, so no event → queue entry. |
| `apps/api/test/support/p4-pending-be-f.ts` | Emptied: all 20 operations are routed. |
| `apps/api/test/integration/contract/p4-exercises-be-f.ts` | All 20 operations exercised through `ctx.mirrored`; `P4_MIRRORS_BE_F` has 20 entries. |
| `apps/api/test/integration/contract/contract.test.ts` | **Only** the media-type pin line and its comment: `[229, 228, 1]` → `[237, 236, 1]` (as the assignment instructs; see §5). |
| `apps/api/test/integration/governance/meeting-fixtures.ts` (new) | Test world: BE-B's approval world plus TL/WL mappings and the forum map; a calendar-less organization; attendance and agenda-item fixtures (BE-F2 owns those APIs). |
| `apps/api/test/integration/governance/forums.test.ts` (new) | 12 tests (REQ-PB-060 A01, REQ-S10-005, REQ-S16-019 Forum; AUD 403 and ADM-only 404). |
| `apps/api/test/integration/governance/meeting-series.test.ts` (new) | 11 tests (REQ-PB-060 A01 generation, REQ-S10-005 A06 regeneration, calendar). |
| `apps/api/test/integration/governance/meetings.test.ts` (new) | 12 tests (chair rules, state machine, quorum read model, cut-off, `nextForumDateProvider`). |
| `apps/worker/test/integration/meeting-series.test.ts` (new) | 5 tests (job idempotency, worker rows, holiday, no calendar, production worker). |
| `docs/delivery/handbacks/DG4/T-DG4-BE-F-*` | This handback and its evidence logs. |

I wrote no migration (§D.4: BE-F has no migration number). I did not edit `governance/index.ts`, `server.ts`, `decision-rights.ts` or any other task's file.

## 2. Behaviour delivered, per requirement row

### REQ-PB-060

Acceptance text: *"A01: the five layers are seeded with cadence text verbatim; a forum meeting series generates meetings on the configured recurrence"*.

- **Five layers, verbatim.** `listForums` on a transformation created through `POST /transformations` (BE-C's switch runs `p4_instantiate_transformation`, which also runs `p4_instantiate_forums`; I did not seed forums again) returns the five B0093 layers in order. Each `source` carries the verbatim Layer, Cadence, Purpose, Participants and Outputs, PROVISIONAL Arabic (`arProvisional: true`) and `sourceRef`. The test asserts the cadence texts exactly: "Monthly", "Bi-weekly", "Weekly", "Daily / 2-3x week", "Monthly", plus all five columns of every row (`forums.test.ts`, "REQ-PB-060 A01 …"). Editing a forum never changes `forum_template`, which the test also asserts.
- **Generation on the configured recurrence.** `createMeetingSeries` generates the meetings up to the horizon in the same transaction.
  - A weekly Workstream Review series with a 56-day horizon creates exactly 8 meetings, one per week on the configured weekday, 7 days apart. Each meeting has the WL-mapped chair, a working-day cut-off, rule version 1 and a 10:00 Asia/Riyadh start.
  - Running `generateSeriesMeetings` twice creates no duplicate (`meeting-series.test.ts`).
  - The worker job does the same, as `worker` meetings with a `service` audit actor. A second run on the same business day is a `runOnce` duplicate, and a re-generation outside the ledger creates none (`apps/worker/test/integration/meeting-series.test.ts`).
  - A daily Rapid Response series skips Friday, Saturday and an administered holiday, both through the API and through the job.
  - Without a business calendar, a daily series generates nothing and reports `generationUnknownReason: "calendar_not_configured"`. The job sends one inbox notice to the series author. A `keep` weekly series generates with an Unknown cut-off.

### REQ-S10-005

Acceptance text: *"A06: changing Workstream Review from weekly to fortnightly regenerates future meetings only"*.

`PATCH …/meeting-series/{id}` `{ intervalCount: 2 }` does the following, in one transaction under lock 730238 (`meeting-series.test.ts`, "weekly -> fortnightly"):

- steps `ruleVersion` 1 → 2;
- cancels exactly the future `scheduled` meetings without content, with `cancel_reason = 'series_regenerated'` and the person as actor, each audited `meeting.cancel`;
- keeps, unchanged at version 1 and rule version 1:
  - a past series meeting;
  - today's series meeting;
  - a future meeting with an agenda item;
- returns those three in `keptMeetingIds`;
- generates the fortnightly occurrences from tomorrow (14 days apart, the same weekday), except a nominal date still held by the kept meeting.

A non-recurrence change (the horizon) steps the version but not the rule, and cancels nothing. `endMeetingSeries` cancels the same set with `series_ended`. The other configurable items the row names are versioned and audited through `updateForum` and the participant operations, and the template is unchanged (`forums.test.ts`): participants (`participantParties`, `forum_participant` rows), cut-off (`cutoffWorkingDays`) and agenda rules (`executiveAsksOnly`, `agendaMaxItems`, `lateItemsRule`, `publishRequiresAnyOutput`).

### REQ-S16-019 (the Forum and Meeting part)

Acceptance text: *"A09: the ERD and migrations contain every entity listed (Forum, Meeting, AgendaItem, Attendance, Minutes, MeetingActionLink) with primary keys, owner and status where applicable, and an integration test creates and reads each one through the API with authorization enforced"*.

- **Forum:** created (`createForum`) and read (`getForum`, `listForums`) through the API. AUD and TL get 403; ADM-only and another organization get 404; the permission is re-checked at commit time.
- **Meeting:** created (`createMeeting`) and read (`getMeeting`, `listMeetings`). SP and AUD get 403; ADM-only and another organization get 404; commit time is covered.
- **Not covered here:** AgendaItem, Attendance, Minutes and MeetingActionLink, and the `entity-group.test.ts` itself, belong to BE-F2 (§D.3). This row is **not complete** until BE-F2 lands.

### Proofs required by §D.1

| Proof | Where |
|---|---|
| five layers, B0093 cadence verbatim | `forums.test.ts` "listForums returns the five B0093 layers …" |
| weekly series: one meeting per week to the horizon; the job run twice creates no duplicate | `meeting-series.test.ts` (first two tests); worker test "a weekly series …" |
| weekly → fortnightly: cancels only future empty scheduled meetings, keeps today's, past and content meetings, generates the fortnightly dates | `meeting-series.test.ts` "cancels future empty meetings …" |
| daily series skips non-working days on the business calendar | `meeting-series.test.ts` "a daily Rapid Response series skips …"; worker test "a daily series …" |
| unmapped chair → `chairUserId: null`, `publishMeetingAgenda` 422 `meeting.chair_unassigned` | `meetings.test.ts` "a forum without a mapped chair …" (Value Review, FIN unmapped) |
| non-chair → 403 `meeting.not_chair` | `meetings.test.ts` (TO, SP and WL hold `meeting.chair`, but none is this meeting's chair) |
| `nextForumDateProvider`: the next scheduled Executive SteerCo, or Unknown | `meetings.test.ts` "nextForumDateProvider …": Unknown before any SteerCo; past and cancelled meetings ignored; the earliest future one wins; BE-C's T11 due-date preview for "Funding reallocation" moves from `no_steerco_scheduled` to that date |
| AUD 403 and ADM-only 404 in each test file | `forums.test.ts`, `meeting-series.test.ts`, `meetings.test.ts` |
| S-4 per mutation: authorization (positive and negative, commit time), validation, If-Match 428/409, creates at version 1, audit event in the same transaction | the three API test files; commit-time cases use BE-A's `afterIdentity`/`revokeAll` |

## 3. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline; disposable PostgreSQL 16.13 through `tests/qa/support/with-pg.sh` on harness port 23950 (pool 23951–23999). Logs are in `docs/delivery/handbacks/DG4/T-DG4-BE-F-evidence/`.

| # | Command (from the worktree root) | Environment | Exit | Result | Log |
|---|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG3` (at the start) | — | 0 | `PASS gate DG3 (historical)` | `validate-dg3-start.log` |
| 2 | `pnpm -r typecheck` | — | 0 | every package clean | `typecheck.log` |
| 3 | `pnpm -r build` | — | 0 | every package built | `build.log` |
| 4 | `pnpm lint` | — | 0 | `eslint . --max-warnings=0` clean | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | — | 0 | "All matched files use Prettier code style!" (every batch) | `prettier.log` |
| 6 | `pnpm openapi:lint` | — | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 607 operations` (contract unchanged by this task) | `openapi-lint.log` |
| 7 | `pnpm test` | LANG/LC_ALL/LC_CTYPE/LANGUAGE unset | 0 | Vitest run 1: 117 files, **2231 passed**; run 2 (`unit-formula-nocodegen`): 3 files, **259 passed, 2 skipped** | `unit-locale-unset.log` |
| 8 | `pnpm test` | `LANG=C.UTF-8 LC_ALL=C.UTF-8` | 0 | the same: **2231 passed**; **259 passed, 2 skipped** | `unit-c-utf8.log` |
| 9 | `QA_PG_PORT=23952 MTH_PORT_POOL=23953-23999 tests/qa/support/with-pg.sh pnpm test:integration` | PostgreSQL 16.13, disposable, UTF8/C | 0 | **110 files, 1239/1239 passed**, no retries | `integration.log` |
| 10 | `node tools/gates/validate.mjs --historical --stage DG3` (at the end) | — | 0 | `PASS gate DG3 (historical)` | `validate-dg3-end.log` |

**Counts against the D-101 merged tree** (unit 2208 + 259/2; integration 1199):

- Unit: +23. These are 19 `recurrence.test.ts` tests and 4 `db-errors-p4-meetings.test.ts` tests.
- Integration: +40. These are 12 `forums`, 11 `meeting-series`, 12 `meetings` and 5 worker `meeting-series` tests. The contract test file keeps its 45 tests; the BE-F exercise case now routes 20 operations.

**Pinned-count change:** only the media-type pin (§4). The 485/607 operation pin is unchanged.

**Disclosed non-zero exits during development** (all fixed before the final runs above):

1. `pnpm lint` exit 1 on the first run: an unused import (`ruleNeedsCalendar`) in `meeting-series.ts`. Removed.
2. The first full `prettier --check` exited 123: `meeting-fixtures.ts` needed a second `prettier --write` pass, because one pass did not reach the stable format. Reformatted, and the re-run exits 0.
3. The first unit run of `apps/api/src/modules/platform/` failed 1 test: `advisory-locks.test.ts` forbids lock-class literals in module sources, and two of my comments spelled "730238". I replaced them with the registry name, and the re-run passes.
4. The first full unit run (both locales) failed 1 test: `architecture.test.ts` (module boundaries). My new unit test sat in `governance/` and imported `../platform/db-errors.ts` past the platform's public surface. I moved it to `platform/db-errors-p4-meetings.test.ts`, and the re-runs below pass. The first-run logs were overwritten by the re-runs; the failure output is quoted in this item.
5. `tsc` (api) exit 2 twice during development (index-signature property access in test files). Fixed.

The single-file integration runs during development all passed on their first run: contract 45/45, forums 12/12, series 11/11, meetings 12/12, worker 5/5.

## 4. Operations routed (delta to `p4-pending-be-f.ts`)

20 → 0. Routed, exercised in `p4-exercises-be-f.ts` and mirrored in `P4_MIRRORS_BE_F`:

- `listForums`, `createForum`, `getForum`, `updateForum`;
- `listForumParticipants`, `addForumParticipant`, `removeForumParticipant`;
- `listMeetingSeries`, `createMeetingSeries`, `getMeetingSeries`, `updateMeetingSeries`, `endMeetingSeries`;
- `listMeetings`, `createMeeting`, `getMeeting`, `updateMeeting`, `publishMeetingAgenda`, `startMeeting`, `closeMeeting`, `cancelMeeting`.

**Media-type pin delta:** +8 JSON bodies, `[229, 228, 1]` → `[237, 236, 1]`. The 8 are `createForum`, `updateForum`, `addForumParticipant`, `createMeetingSeries`, `updateMeetingSeries`, `createMeeting`, `updateMeeting` and `cancelMeeting`. The bodiless POSTs declare no `consumes` (S-3): `removeForumParticipant`, `endMeetingSeries`, `publishMeetingAgenda`, `startMeeting` and `closeMeeting`. Concurrent tasks change the same pin, so the orchestrator reconciles it at merge.

## 5. Contract and schema needs, and deviations (for the orchestrator)

1. **Schema need: a `job_schedule` row.** `governance.meeting_series_generate` needs a migration from the repair range, for example `('01920004-0001-7000-8000-0000000000xx', 'governance.meeting_series_generate', 'governance.meeting_series_generate', '35 0 * * *', 'Asia/Riyadh', …, 'governance')` plus its `job_schedule.create` audit row, as in `0050`/`0054`. Until then:
   - the handler and queue are registered, but `schedules.ts` never schedules the job (no row), so the "daily schedule" part of §D.1 is **not live**;
   - generation happens when a series is created or changed, and whenever the job is sent;
   - the worker test drives the job directly and through `boss.send`.
2. **New refusal code `meeting.quorum_locked`** (422), with the text "The quorum is set before the session starts; this meeting is {status}.". It refuses `updateMeeting` of `quorumMin` once a meeting is `in_session` or `held` (ADR-0032 §3.1, "editable until the session starts"). ADR-0032 §11 names no code for this, so this departs from S-11. It needs the architect's acceptance and an FE-A `problems.json` key.
3. **New 400 field-error codes** (i18n keys): `validation.user_unknown` (a secretary, chair or participant who is not an active user of the organization), `validation.group_unknown`, `validation.forum_unknown` (a `forumId` in a body that is not a forum of this transformation) and `validation.end_before_start` (series `endDate` < `startDate`). ADR-0032 §11 has no line for these.
4. **New inbox message key** `governance.notice.series_calendar_not_configured`, with params `seriesId` and `ruleVersion`. FE needs to translate it (en and ar).
5. **`createdSource` of series meetings created by the API.** ADR-0032 §2 says generated meetings are `created_source = 'worker'`. As built:
   - meetings generated inside `createMeetingSeries`/`updateMeetingSeries` are `api` meetings, authored by the person who made the change, with that person as audit actor;
   - only the job's meetings are `worker` (`created_by` NULL, actor `service`).

   This keeps the author on the record. The `meeting_created_source` CHECK allows both. Accept or redirect.
6. **Unknown output kinds give 400, not 422.** The OpenAPI `MeetingOutputKind` enum makes an unknown output kind a 400 (zod mirror), so the API never returns 422 `forum.output_kind_invalid`; that code is only the database last line. An empty `outputKinds` is also 400 (`minItems: 1`).
7. **Daily interval semantics.** `intervalCount` on a daily series counts calendar days from `startDate`; non-working days are then dropped. For example, interval 2 means every second calendar day that is a working day. ADR-0032 §2 says "every interval_count-th day counted from start_date, working days only", which I read this way.
8. **A series `location` change** applies only to meetings generated afterwards; existing meetings keep their own location. A recurrence change regenerates future empty meetings, and these pick up the new location.
9. **`addForumParticipant` `Location` header** points to the participants list, because the contract has no single-participant GET.
10. **Files outside the §D.1 ownership list:**
    - `contract.test.ts`: only the pin line. p4-work-split §D.0 says tasks never edit this file, but the assignment explicitly requires the pin edit; the assignment wins.
    - Two new test files: `test/integration/governance/meeting-fixtures.ts` (test support, in my own test area) and `src/modules/platform/db-errors-p4-meetings.test.ts` (the unit test of my db-errors block, next to the other `db-errors*.test.ts` files). §D.1 names no test file for the db-errors lines.
11. **Worker twin.** The worker imports no API code (ADR-0002 rule 5), so `handlers/meetings.ts` duplicates the API's insert SQL and calendar loading; the recurrence itself is the shared library (the BE-D2 precedent, D-101). If one side changes, the other must change too. Both are covered by integration tests that assert the same dates.
12. **Helper `resolveChairUser`.** It treats a party mapped to a **group** as "no chair" (null), as ADR-0032 §3.1 says.

## 6. Merge instructions and what remains

- **Migrations:** none. **Ordering:** after the current integration head (`b1d3b7f`).
- **Expected conflicts:**
  - `platform/db-errors.ts`: another slice's block may land at the same anchor. Mine is a separate function placed before `mapDatabaseGuardError`, plus one call before the `_version_step` rule. Every `case` group in my block ends in a `return`, so no label falls through.
  - `schemas/index.ts` and `calc.ts`: append-only lines.
  - `contract.test.ts`: the pin.
- **What remains in §D.1:** only item 1 of §5, the `job_schedule` row (a schema need, so it is not mine to write).
- **Remains for later tasks:**
  - REQ-S16-019 still needs BE-F2 (AgendaItem, Attendance, Minutes, MeetingActionLink, and the entity-group test);
  - the translation keys in §5 need FE work.

**Finished:** `2026-10-09T11:51:56Z` (`date -u`, after the last check), about 78 minutes after the start, within the 2-hour limit.
