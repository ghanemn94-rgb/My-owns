# Handback T-DG4-BE-G (completed by run T-DG4-BE-GB): backend-workflow-engineer

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING). Section `docs/architecture/p4-work-split.md` §D.2.
- **Invocation:** `DG4-T-DG4-BE-GB-backend-workflow-engineer-20261009T133054Z-6d3c4038` (session `6d3c4038-fdf7-45ac-a346-2b9a1831c60e`).
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-BE-GB.md` (sha256 `f3892f15…5f807`, checked).
- **Start revision:** branch `dg4/be-g` at WIP commit `3fc73d0` (parent `489712f`, the integrated HEAD). The changes are **uncommitted**, as instructed.
- **Time:** started 13:31:15Z (`date -u`); the end time is at the bottom of this file.
- Nothing here grants a business, Finance or IT approval. Recording a T16 Outcome is a person's business decision inside the product. No job decides anything, and nothing reads or writes DG0–DG7 records. All test data is synthetic.

## 0. Environment incident (read first)

The shared volume `/dev/vda` (the worktrees and every run's `$TMPDIR`) ran out of space several times between about 13:35Z and 14:24Z. At times it had 0–40 MB free while other runs were writing. This had four effects:

- My first PostgreSQL attempt failed in `initdb`/migrate with `No space left on device`.
- Two of my file writes were cut short. One left `blocker-status.test.ts` truncated; I repaired it at once and verified it. Another `.new` file came out empty, so I redid that write. After the first incident I only wrote to a `.new` file, verified it, and then renamed it.
- One unit run under ENOSPC failed to load 42 `unit-web` suites. That run is **invalid**, so I deleted its log and do not cite it.
- I deleted only my own scratch files. I did not move work to `/tmp`: the protocol makes `/tmp` read-only for agents.

At 14:24Z about 1 GB came free, then about 22 GB, and every check below was run from scratch on the final tree. The orchestrator should look at the disk headroom of the shared volume: about 30 retained worktrees use about 26 GB.

## 1. Salvage (WIP `3fc73d0`)

I reviewed the WIP against §D.2, ADR-0032 §6–§11, ADR-0025/0026, D-088–D-090, D-102 and S-1…S-14 as if someone else had written it. **Kept:** the overall design and almost all of the code, including:

- the routes and services in `executive-decisions.ts` and `escalations.ts`, and the defaults in `escalation-rules.ts`;
- the exact ADR-0032 §11 refusals;
- the zod mirror and the outbox payload;
- the worker jobs;
- the slice D mapper lines, after BE-F's lines and ending in an explicit `return problems.internal()`;
- the pending-list removal and the exercises for all 11 operations;
- the +6 media-type pin;
- the five test files and `t16-fixtures.ts`.

**Changed (defects found, and why):**

1. **ADR-0002 module boundaries.** On the final-tree check, `architecture.test.ts` failed with 12 violations, and `advisory-locks.test.ts` with 2. The WIP had never been verified. The fixes:
   - `governance` imported `jobs` (`enqueueOutboxEvent`), which is not in its `dependsOn`. It now uses a module-local outbox writer, `enqueueBlockerStatusRecorded`, which follows the `kpi/kpi-outbox.ts` precedent and validates the payload against the shared registry.
   - It imported the non-public `workflows/codes.ts`. It now uses `nextDecisionCode`: the same `record_code_counter` UPSERT, covered by the parity test.
   - Ten non-literal computed members became `Map.get`, `.at()`, `.charAt()`, `Object.fromEntries` or a `switch`.
   - The lock numbers in comments became their names.
2. **Blank seven-element fields.** `checkAskElements` treated only absent or null fields as missing. A blank (whitespace-only) `whyNow` therefore got a generic `validation.blank`, not "Why now is required.". Blank text now counts as missing (S-1 `hasText`). A text with an invalid character still gets the schema's own code.
3. **SLA recomputation.** On update, the SLA was recomputed from *today*. ADR-0032 §6 says it applies to the ask's **creation** business date, so the update now uses `organizationBusinessDateAt(created_at)`.
4. **Decision-SLA scan.**
   - (a) An ask in a transformation whose stored `decision_sla` rule was disabled still went through `runOnce`. That spent the ledger key `decision.escalate:<id>:<sla>`, so after the rule was re-enabled the ask could **never** escalate for that SLA date. Such asks are now not selected.
   - (b) Asks already escalated for their current SLA date were re-selected every day. With the 500-row batch, that backlog could starve newer asks. They are now excluded with `NOT EXISTS`. The `runOnce` key and `decision_escalation_once` remain the second and third lines.
5. **Blocker scan.**
   - (a) It selected every (forum, blocker) without an open ask, whatever its latest RAG, so the batch could starve. It now selects only blockers whose **latest** observation in the forum is red. Only those can be red for N cycles.
   - (b) The date in its ledger key used a hard-coded `'Asia/Riyadh'`. It now uses the organization's default calendar timezone, falling back to Asia/Riyadh (ADR-0025 §1).
6. **Unassigned owner of a blocker ask** (ADR-0032 §8.3 "ownerStatus unassigned with the routing error, never a guessed owner"). The WIP left the owner NULL without telling anyone. The transformation lead (else the recorder) now gets one inbox notice, `governance.notice.blocker_ask_owner_unassigned`, with `partyCode` and `routingError` (`party_unmapped` | `party_not_executive`). No work item is created for a missing owner.

**Added:**

- **The D-102 parity test.** The worker's twins (`resolveParty`, `executivesAmong`, `nextDecisionCode`; the worker imports no API code) give the same answers as the API services (`resolveParty`, `holdsExecutiveDecide`, workflows' `nextCode`, and the T16 `nextDecisionCode`). The DEC sequence is one counter in one format across all four.
- **Commit-time (S-4) tests** for `recordExecutiveDecisionOutcome`, `updateExecutiveDecision`, `createEscalationRule`, `updateEscalationRule` and `recordBlockerStatus`. The WIP had one only for `createExecutiveDecision`.
- A blank-element test.
- A disabled-rule test: no escalation, no ledger key spent, and the next scan escalates after the rule is re-enabled.
- A test that the second scan selects nothing, with the `runOnce` replay of the key giving `duplicate`.
- An unassigned-owner notice test, and a test that the scan skips a blocker whose latest cycle is amber.

## 2. Files changed (vs base `489712f`; all uncommitted)

| File | Purpose |
|---|---|
| `apps/api/src/modules/governance/executive-decisions.ts` | T16 routes: `listExecutiveDecisions` (overdue on read, business date in the organization's timezone), `createExecutiveDecision`, `getExecutiveDecision` (`missingElements`, `escalationLevel`), `updateExecutiveDecision`, `recordExecutiveDecisionOutcome`; the exported `createExecutiveAsk` / `recordExecutiveOutcome` for BE-F2; `nextDecisionCode`; the `executive_decision_due` work item |
| `apps/api/src/modules/governance/escalations.ts` | `listDecisionEscalations`, `listEscalationRules`, `createEscalationRule`, `updateEscalationRule`, `listBlockerStatuses`, `recordBlockerStatus` (+ the `blocker_status.recorded` outbox row; module-local writer) |
| `apps/api/src/modules/governance/escalation-rules.ts` | ADR-0032 §8.1 default constants (shared with the worker through `@mth/shared/schemas`) and the rule read model |
| `apps/api/src/modules/governance/blocker-escalation.ts` | API side of the blocker rule: lock `executiveAskBlocker`, blocker existence, the open ask of a blocker (see §6 for why `evaluateBlocker` is in the worker) |
| `apps/api/src/modules/platform/db-errors.ts` | T16, escalation and blocker lines of the slice D block, after BE-F's lines; ends with `return problems.internal()` |
| `packages/shared/src/schemas/executive-decisions.ts` (+ `index.ts` line) | zod mirrors; `blockerStatusRecordedV1`; `ESCALATION_RULE_DEFAULTS`; pure `redForCycles`, `missingAskElements`, `decCode` |
| `packages/shared/src/schemas/events.ts` | registers `blocker_status.recorded` v1 in `OUTBOX_EVENT_SCHEMAS` (two lines; needed by the relay and the outbox writer; outside §D.2's list, flagged in §6) |
| `apps/worker/src/handlers/escalations.ts` | `governance.decision_sla_scan`, `governance.blocker_escalation` (consumer), `governance.blocker_escalation_scan`; `evaluateBlocker`; twins for parity |
| `apps/worker/src/queues/escalations.ts` | the three queue specs; `blocker_status.recorded` → `governance.blocker_escalation` |
| `apps/api/test/support/p4-pending-be-g.ts` | emptied (11 routed) |
| `apps/api/test/integration/contract/p4-exercises-be-g.ts` | all 11 operations through the validating client |
| `apps/api/test/integration/contract/contract.test.ts` | media-type pin `[257, 256, 1]` → `[263, 262, 1]` (**+6** JSON bodies) |
| `apps/api/test/integration/governance/{executive-decisions,escalation-rules,blocker-status}.test.ts`, `t16-fixtures.ts` | API integration tests (`t16-fixtures.ts` is a new support file of these tests) |
| `apps/worker/test/integration/{decision-sla-escalation,blocker-escalation}.test.ts` | worker integration tests with the real handlers |

## 3. Behaviour per requirement row (acceptance texts quoted)

- **REQ-PB-081**, "A09: T16 persists all 9 columns; a decision with Outcome recorded is closed and leaves the overdue list".
  - A created ask persists and returns ID `DEC-nn`, Decision, Why now, Options A/B, Rec., Owner, Decision date, Impact if delayed and Outcome.
  - An overdue ask is listed by `?overdue=true` (the business date in the organization's calendar timezone). The owner records `decided` with an Outcome; the ask becomes `decided` and leaves the overdue list.
  - The other cases tested: a non-owner gets 403 `executive_decision.not_owner`; an active delegate records `decidedOnBehalfOfUserId`; AUD gets 403; ADM-only gets 403 (REQ-S10-003); another organization gets 404; `If-Match` gives 428/409; a deferral or cancellation is final where the ADR says so; the owner's My Work item is created and closed.
  - Tests: `executive-decisions.test.ts`.
- **REQ-PB-082**, "A09;A13: a blocker Red in 2 consecutive cycles (N=2) produces exactly one open T16 ask; re-running the job creates no duplicate".
  - Red in two consecutive meetings of a forum creates one ask (owner and deadline from `addWorkingDays` on the business calendar). Re-delivering the event, re-running the consumer and running the scan create none. An amber cycle, or a cycle without an observation, ends the run.
  - After the ask is decided, a new red run creates a new one. A disabled rule creates nothing. An unmapped owner party gives an unassigned ask with the lead's notice.
  - Tests: `blocker-escalation.test.ts` (worker), `blocker-status.test.ts`.
- **REQ-S10-012**, "A09: an ask without 'why now' is rejected by the API".
  - The answer is 400 `executive_decision.field_required` at `/whyNow`, "Why now is required.", and no row is written. Each element has its own pointer and text, including blank values.
- **REQ-S12-011**, "A09;A13: an SLA expiring on a working day escalates once to the next authority and shows the delay impact text".
  - The first working-day scan after the SLA date writes one `decision_escalation` to SP (the default chain) with `delay_impact`. A second scan creates nothing; a replay of the `runOnce` key is `duplicate`.
  - The decision row is untouched. Nothing happens on a non-working day, and an Unknown SLA date is never escalated.
  - `party_unmapped` gives a row plus the owner's notice. An exhausted chain gives `no_next_authority`. A mapped owner is skipped. A deferral allows one more escalation. A disabled rule spends no key.
  - Tests: `decision-sla-escalation.test.ts` (worker).

## 4. Checks (final tree; real exit codes; logs in `docs/delivery/handbacks/DG4/T-DG4-BE-G-evidence/`)

| Check | Exit | Result | Log |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG3` (at start and again at the end) | 0 / 0 | `PASS gate DG3 (historical)` | `validate-historical-DG3.txt` |
| `pnpm -r typecheck` | 0 | 7 projects Done | `typecheck.txt` |
| `pnpm -r build` | 0 | 7 projects Done | `build.txt` |
| `pnpm lint` | 0 | — | `lint.txt` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.txt` |
| `pnpm openapi:lint` | 0 | PASS, 607 operations | `openapi-lint.txt` |
| `pnpm test`, locale unset (`LANG`/`LC_*` empty) | 0 | 2258 passed (118 files) + 259 passed / 2 skipped | `unit-locale-unset.txt` |
| `pnpm test`, `LANG=LC_ALL=C.UTF-8` | 0 | 2258 passed + 259 passed / 2 skipped | `unit-c-utf8.txt` |
| `QA_PG_PORT=24270 MTH_PORT_POOL=24271-24299 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | 121 files, **1320/1320 passed** (D-102 base 1283 + 37 BE-G); 14:40:57Z–14:55:32Z, started after the last source edit | `integration-full.txt` |

**Earlier runs, disclosed:**

- **The ENOSPC PostgreSQL attempt.** Migrate failed with "No space left on device". No log was kept, because the disk was full.
- **The invalid ENOSPC unit run.** Deleted (§0).
- **`unit-locale-unset-prefix-run.txt`** (exit 1, 2 failed / 2256). This is the run that found the WIP's `architecture.test.ts` and `advisory-locks.test.ts` violations, which are now fixed (§1 item 1).
- **`integration-be-g-files-run1.txt`** (exit 1, 1 failed / 81). This was my own new disabled-rule test: it POSTed a `decision_sla` rule that an earlier test in the same file had already stored, giving 409. I fixed the test to disable the existing rule.
- **`integration-full-prefix-run.txt`** (exit 1, 1 failed / 1319 of 1320). It ran from 14:26Z while I was still fixing the module boundaries, so it ran on a **changing tree**. The one failure, `nextDecisionCode is not a function` in the parity test, came from that mid-run edit: the edited test file met the cached, pre-edit `executive-decisions.ts`. It is not cited as a result; the final-tree run above is.

**Pinned counts:**

- The media-type pin goes from `[257, 256, 1]` to `[263, 262, 1]`, **+6**: `createExecutiveDecision`, `updateExecutiveDecision`, `recordExecutiveDecisionOutcome`, `createEscalationRule`, `updateEscalationRule`, `recordBlockerStatus`.
- The operation count of 607 is unchanged.
- No other pin changed.

## 5. Operations routed (delta to `p4-pending-be-g.ts`)

All 11 are removed from the pending list (now `[]`) and exercised in `p4-exercises-be-g.ts`: `listExecutiveDecisions`, `createExecutiveDecision`, `getExecutiveDecision`, `updateExecutiveDecision`, `recordExecutiveDecisionOutcome`, `listDecisionEscalations`, `listEscalationRules`, `createEscalationRule`, `updateEscalationRule`, `listBlockerStatuses`, `recordBlockerStatus`.

## 6. Contract, schema and merge needs (for the orchestrator)

1. **Schema need (repair range; not written, D-094).** There are no `job_schedule` rows for `governance.decision_sla_scan` and `governance.blocker_escalation_scan` (daily, organization timezone, default `Asia/Riyadh`). Until they exist, the two scans are handled but never started by the schedule kit; the event consumer works. This is the same gap as BE-F's `meeting_series_generate` (D-102 "Carried forward"), so the rows could share BE-K's `0059` or another repair number.
2. **D-102 fan-out merge.** `queues/escalations.ts` uses the current `Record<string, string>` event → queue shape. If KBE-F's registry change (event → list of queues) merges first, `"blocker_status.recorded": "governance.blocker_escalation"` becomes a one-element list.
3. **Accepted-deviation candidates (for the reviewers):**
   - `evaluateBlocker` is in `apps/worker/src/handlers/escalations.ts`, not `governance/blocker-escalation.ts` as §D.2 lists it. ADR-0002 rule 5 and D-102 item 2 require this; no API operation evaluates the rule.
   - `packages/shared/src/schemas/events.ts` got two lines (the payload registry entry), outside §D.2's file list. The relay and the outbox writer need them; this follows BE-H's line.
   - The `decision_one_open_blocker_ask` last-line text reads "…for this blocker: see the T16 log." because a unique-index error does not carry the existing ask's code. The API path, which runs first under the lock, gives the exact ADR text with `{code}`. The `decision_ask_complete` last line lists all the elements in one message, because a CHECK error cannot name the missing one.
   - A disabled stored `decision_sla` rule also stops escalation of asks that have a T11 chain. I read the rule's `enabled` flag as switching the automation off for the transformation.
4. **i18n keys for FE (EN/AR):**
   - work items: `governance.task.executive_decision_due`, `governance.task.executive_decision_escalated`;
   - notices: `governance.notice.executive_decision_escalated`, `governance.notice.blocker_ask_calendar_not_configured`, `governance.notice.blocker_ask_owner_unassigned`;
   - problem codes used outside ADR-0032 §11: `validation.decision_right_unknown`, `validation.blocker_pair`.
5. **Merge:** no migration. In `db-errors.ts`, my lines sit inside BE-F's `mapP4GovernanceMeetingError`, after `case "meeting_times"`, and end with `return problems.internal()`. BE-F2's lines go after them.

## 7. What remains

- The `job_schedule` rows (§6.1) need an orchestrator-allocated repair migration.
- Work items do not follow a later change of an ask's required date (the carried D-102 item). Re-owning an ask does move the work item.
- Everything else in §D.2 is done. Nothing in this section is left for a second half.

**End:** Fri Oct  9 14:56:07 UTC 2026 (`date -u`). The handback and evidence were written after the final runs; no source or test changed after the final integration run started.
