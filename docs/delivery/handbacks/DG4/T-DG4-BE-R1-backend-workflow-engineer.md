# Handback T-DG4-BE-R1 (backend-workflow-engineer): P4 repair scope, items 1 to 6

- **Invocation:** `DG4-T-DG4-BE-R1-backend-workflow-engineer-20261009T210722Z-2c45debc` (session `2c45debc-174d-4ceb-8e3e-8b4f3e034dbe`).
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-BE-R1.md`. Its sha256 `bed9ae8a…d560644` was checked at the start and matches.
- **Base:** `7aac2ad184fe88e76c620a6b426b4cbeba83af48` on branch `dg4/be-r1`. The changes are **uncommitted**, as the assignment asks.
- **Time:** start `2026-10-09T21:09:47Z`; end `2026-10-09T22:06:13Z` (`date -u` both times; about 57 minutes).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` gave exit **0** (`PASS gate DG3 (historical)`), at the start and again at the end (§4).
- **No migration.** I used no migration number. `0060` and `0061` are still ARCH-R1's.
- **No new route, and no new JSON request body.** The media-type pin in `contract.test.ts` is unchanged (delta **0**). No `p4-pending-*` list changed, because I routed no operation (§5).
- **Gates:** I granted no business, Finance or IT approval. The one approval the tests create (item 3) stays **pending**; nobody decides it. All test data is synthetic. Nothing here touches DG0–DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/tasks/service.ts` | **Item 1.** Adds `rescheduleWorkItemsOfSubject` (moves a source's open items to its new due date) and `reassignWorkItemOfSubject` (cancels other assignees' open items and opens one for the new owner, under the first free key of `<key>`, `<key>#2`, …). Both are idempotent, audited per item, run in the caller's transaction, and do no remote I/O. Adds the types `WorkItemSourceRef` and `WorkItemReassignResult`. |
| `apps/api/src/modules/tasks/index.ts` | Exports the two services and their types. |
| `apps/api/src/modules/tasks/routes.ts` | **Item 2.** `SYSTEM_MANAGED_KINDS` gains `corrective_case_follow_up`. |
| `apps/api/src/modules/tasks/tasks.test.ts` | The unit pin of `SYSTEM_MANAGED_KINDS` now lists the three kinds. It also asserts that `raid_action_due` is not system managed. |
| `apps/worker/src/kit.ts` | **Item 1, worker side (D-102).** Twins of both services: same SQL, same audit events. The worker imports no API code (ADR-0002 rule 5). |
| `apps/worker/src/index.ts` | Exports the twins and their types. |
| `apps/api/src/modules/raid/actions.ts` | **Item 1 consumer.** `updateAction` calls `followActionTask`: reassign on an owner change, reschedule on a due-date change. Creation still goes through `createWorkItemOnce`, unchanged. |
| `apps/api/src/modules/raid/corrective-cases.ts` | **Item 1 consumer:** `updateCase` calls `followFollowUp`, which reassigns on an owner change and reschedules on a follow-up-date change. **Item 6:** the `createCase` insert decides the one-open-case rule itself (`ON CONFLICT (transformation_id, source_kind, source_scope_key) WHERE status <> 'closed' DO NOTHING`, under the existing correctiveCase lock), then reads the open case's code. The separate pre-read is removed, so the refusal has one path and always names the real code. |
| `apps/api/src/modules/adoption/interventions.ts` | **Item 1 consumer.** `updateIntervention` calls `followInterventionTask`: reassign on an owner change, reschedule on a due-date change. Clearing the owner to null still cancels the item, as before. |
| `apps/api/src/modules/governance/executive-decisions.ts` | **Item 1 consumer.** `updateExecutiveDecision` reassigns the `executive_decision_due` item on an owner change and reschedules it when the required date (`due_date`) changes. The escalated-item kind is left alone. `ownerWorkItem` now builds its input through `ownerWorkItemInput`; the rows it writes are unchanged. |
| `apps/api/src/modules/platform/db-errors.ts` | **Item 6.** `corrective_case_one_open_key` now maps to 500 (a programming error). It no longer returns 409 with "(unknown)". See §6.2, an ADR text need for ARCH-R1. |
| `apps/api/src/modules/raid/corrective.test.ts` | Unit test of the mapper change: 500, and no "(unknown)" text. |
| `apps/api/src/server.ts` | **Item 4 only.** `registerApprovalSubject`, `requestApprovalInTx` and `toApprovals` are imported from `modules/workflows/index.ts`, in the same import as `registerWorkflowsModule`. No other line changed. `server.ts` no longer imports anything from `workflows/approvals.ts`. |
| `packages/shared/src/schemas/benefits.ts` | **Item 5.** `benefitRegisterRow` gains the inline member `initiatives: z.array(z.strictObject({ id: uuid, code: z.string(), name: z.string() })).optional()`, exactly as requested. |
| `apps/api/test/integration/tasks/work-items.test.ts` | Service tests: reschedule moves the date once, is audited, a repeat writes nothing, and a closed item never moves. Reassign A → B → A leaves one open item, for A, under `#2`; repeats are `unchanged`; a reminder is created per new item; the cancellation is audited with reason `reassigned`. The **D-102 parity test** compares the API services and the worker twins: same outcomes, rows and audit events. |
| `apps/api/test/integration/raid/actions.test.ts` | Consumer proof for RAID actions (date change, then A → B → A). |
| `apps/api/test/integration/raid/corrective-cases.test.ts` | Consumer proof for corrective cases (follow-up date, then A → B → A). **Item 2** refusal proof. **Item 6** proof: concurrent creates give one 201, and the others get 409 naming the real code. |
| `apps/api/test/integration/adoption/interventions.test.ts` | Consumer proof for adoption interventions. |
| `apps/api/test/integration/governance/executive-decisions.test.ts` | Consumer proof for executive asks. |
| `apps/api/test/integration/sustainment/transition-decisions-server-wiring.test.ts` (new) | **Item 3.** Builds the real server through the harness without wiring anything by hand, then submits a transition decision and gets 200. |
| `apps/api/test/integration/contract/benefit-register-mirror.test.ts` (new) | **Item 5.** Contract test that parses a **non-empty** register page with `benefitRegisterPage`. |
| `docs/delivery/handbacks/DG4/T-DG4-BE-R1-backend-workflow-engineer.md`, `…/T-DG4-BE-R1-evidence/*.log` | This handback and its logs. |

## 2. Behaviour delivered, per item and requirement row

### Item 1: work items follow their source (D-102, D-105; BE-D, BE-D2, BE-H, BE-G handbacks)

**Design.** The 0028 `work_item_guard` makes an item's assignee and dedupe key immutable, and a closed item never reopens. So a returning owner (A → B → A) cannot get the old item back.

- `reassignWorkItemOfSubject` cancels every open item of the source's kind whose assignee is not the new owner (`work_item.cancel`, reason `reassigned`). If the new owner already holds an open item, nothing else happens.
- Otherwise it creates the new owner's item through `createWorkItemOnce`. It uses the ADR dedupe key `<key>` when that key is free, else the first free of `<key>#2`, `<key>#3`, … (at most 100 tries, then a programming-error throw).
- The base key stays reserved, so a redelivered creation (worker or API) still creates nothing.
- `rescheduleWorkItemsOfSubject` updates `due_date` on the source's open items of the given kinds (`work_item.reschedule`, with the changes `{ due_date: { from, to } }` and the version + 1). Items already on that date are skipped.
- **Idempotency:** a repeat call finds nothing to change and writes nothing (proved).
- **Concurrency:** the caller holds the source row's `FOR UPDATE` lock, and the services lock the open items `FOR UPDATE` in id order.
- **Consumers:** each calls reassign only when the owner changed, and reschedule only when the date changed. So a plain edit never recreates an item that its owner already completed by hand.

**Proofs** (integration, real PostgreSQL):

- Services: `work-items.test.ts` › "work items follow their source": reschedule; reassign A → B → A (one open item, for A, key `…#2`; repeats `unchanged`); and **parity**, where the worker twins produce the same outcomes, the same rows and the same audit events (actions, actor, source, versions, reason, changes).
- RAID actions (`actions.test.ts`): a due-date change moves the open item's due date (audited `work_item.reschedule`); a title edit writes nothing to the item; A → B → A gives `[A cancelled, B cancelled, A open #2]`, so exactly one open item, for A.
- Corrective cases (`corrective-cases.test.ts`): same, with the follow-up date. A repeat with the same owner and date adds no item.
- Adoption interventions (`interventions.test.ts`): same, with the due date.
- Executive asks (`executive-decisions.test.ts`): same, with the required date (`decisionDate`).

**Requirement rows** (acceptance quoted). No existing behaviour changes:

- REQ-S11-001, "A11: … an intervention with owner and due date appears in My Work". After this change the item also follows its owner and due date.
- REQ-PB-085, "A04;A11;A13: a benefit below plan creates one corrective action; repeated evaluation does not duplicate it; …". Case creation and deduplication are unchanged. The follow-up item now follows the case.
- REQ-PB-081, "A09: T16 persists all 9 columns; a decision with Outcome recorded is closed and leaves the overdue list". Unchanged; the owner's item now follows the ask.
- REQ-S12-005, "A13: a period opening creates one task per KPI owner; a worker restart during the run creates no duplicates". The idempotent-creation rule is kept, because the base key stays reserved.

### Item 2: `corrective_case_follow_up` is system managed (BE-D2 handback §2)

`SYSTEM_MANAGED_KINDS` now holds `approval_decision`, `approval_escalated` and `corrective_case_follow_up`. The test "the follow-up is system managed" proves:

- the owner (BO) completing it gets 422 `work_item.system_managed` with the ADR-0025 §4 text;
- the item stays open, and its audit trail is still only `work_item.create`;
- closing the case then closes the item (ADR-0031 §5.6).

### Item 3: BE-J server path (D-107)

The new file `transition-decisions-server-wiring.test.ts` calls none of `wireTransitionDecisionApprovals`, `wireApprovals`, `seedClosureWorld` or `closeTransformationGoverned`. It builds the world from the same non-wiring fixtures that `seedClosureWorld` uses.

- Vitest isolates each file's module graph, so no other file's wiring can leak in.
- To prove the composition root does the wiring, the test wraps the real sustainment module with `vi.mock`, only to **count** calls of `wireTransitionDecisionApprovals`. The count is 0 before `startApi()` and 1 after it (the real `buildServer`).
- A BO submits a draft decision and gets **200** `submitted`. Exactly one `benefit_transition_decision` approval exists, `pending`.

REQ-S11-007 ("A11: after the transition decision, the benefit's forecast is still shown as forecast and monitoring tasks appear for the residual owner"): this repair proves only the production-wiring path of submit. The rest of the row is BE-J's and is unchanged.

### Item 4: KBE-C import

`server.ts` imports the approval service only from `workflows/index.ts`. `grep -n "workflows/approvals" apps/api/src/server.ts` finds nothing. The other importer that names `approvals.ts` is a comment in `kpi/kpi-versions.ts`, not an import.

### Item 5: benefit register mirror (BE-M handback §2.1)

The member is added inline, as requested; importing `initiativeRef` would create a circular import. The new contract test does three things:

1. It allocates the benefit to an initiative, then lists the register through the validating client, which checks the response against the OpenAPI operation.
2. It parses the **non-empty** page with the strict `benefitRegisterPage` and asserts `initiatives = [{ id, code, name }]`.
3. It shows that an extra key inside a reference is refused, and that the old mirror (without the member) rejects the same page.

REQ-PB-010 ("A01: renaming an initiative changes it in roadmap, scorecard and benefits register views in one update; no duplicate initiative rows exist in the database"): BE-M's proof is unchanged. The mirror can now parse the register views it relies on.

### Item 6: duplicate corrective case message (BE-D2 handback §4)

I took the first option: **the service path is now the only path that can produce this refusal.**

- `createCase` no longer pre-reads the open case. Under the correctiveCase advisory lock (the same one the worker takes), the insert itself carries `ON CONFLICT … WHERE status <> 'closed' DO NOTHING` on `corrective_case_one_open_key`.
- When nothing is inserted, it reads the open case's code and answers 409 `corrective_case.already_open` with "An open corrective action already exists for this finding: CA-nn.". The code counter's increment rolls back with the transaction.
- No other API write can reach that index: the source fields are immutable, and a PATCH never reopens a case. So the database mapper now treats it as a programming error (500), and the "(unknown)" text no longer exists anywhere.

Proofs:

- The existing duplicate test is still green; it now runs through the `ON CONFLICT` branch, because there is no pre-check.
- The new concurrent test: three creates for one finding give exactly one 201, and every other call gets 409 with the winner's code.
- The unit test of the mapper (500, no "(unknown)").

## 3. Checks

All commands ran in `/home/user/wt/dg4-be-r1` with Node 24.21.0, offline. The logs are in `docs/delivery/handbacks/DG4/T-DG4-BE-R1-evidence/`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG3` (start) | 0 | `PASS gate DG3 (historical)` | (output quoted above) |
| 1 | `pnpm -r typecheck` | 0 | 7 projects Done | `typecheck.log` |
| 2 | `pnpm -r build` | 0 | — | `build.log` |
| 3 | `pnpm lint` | 0 (second run) | 0 problems. The first run exited **1** on my new test file (an `import()` type annotation, `consistent-type-imports`). I fixed it and re-ran; `lint.log` is the passing run. | `lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (every batch) | `prettier.log` |
| 5 | `pnpm openapi:lint` | 0 | — | `openapi-lint.log` |
| 6 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | 0 | unit 121 files / **2313** passed; formula-nocodegen 3 files / **259** passed, 2 skipped | `unit-locale-unset.log` |
| 7 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same: **2313**, and **259** + 2 skipped | `unit-c-utf8.log` |
| 8 | `QA_PG_PORT=24810 MTH_PORT_POOL=24811-24849 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **157 files / 1576 tests passed** (PostgreSQL 16.13, disposable cluster, port 24810) | `integration.log` |
| 9 | `node tools/gates/validate.mjs --historical --stage DG3` (end) | 0 | `PASS gate DG3 (historical)` | `validate-dg3-historical.log` |

Disclosures:

- **The first full integration run was stopped by my own tool limit, not by a test.** I started it in the background with a 10-minute limit. That is too short for the suite: the tool stopped it after 80 files had passed, with 0 failures. Its partial log is kept as `integration-run1-killed-at-10min.log`. I re-ran the whole suite with a 60-minute limit; that run is check 8.
- **Targeted runs during development:**
  - One assertion in my new executive-decision test read `requiredDate`, but the response field is `decisionDate`. I fixed the test, not the code; 17/17 then passed.
  - The new wiring test passed 2/2 on both of its runs.
- **Unit count unchanged:** 2313 is D-108's number. I changed two existing unit tests and added none.
- **Disk:** `df -h .` showed 22 GB free before each full run, above the 3 GB stop line.
- **Untracked device files:** the worktree shows untracked character devices such as `.bashrc`, `.mcp.json` and `CLAUDE.local.md` (sandbox mounts of `/dev/null`, not mine). Prettier's check passed with them listed, and I did not touch them.

## 4. Integration result and end-of-run checks

- **Integration:** exit **0**, with **157 files and 1576 tests passed, 0 failed** (start 21:48:41Z, duration 986.67 s).
  - That is D-108's 1564 plus my **12**: work-items +3, actions +1, corrective cases +3, interventions +1, executive decisions +1, `benefit-register-mirror.test.ts` +1 (new file), and `transition-decisions-server-wiring.test.ts` +2 (new file).
  - No pinned count changed. The contract media-type pin is untouched.
- **`validate --historical --stage DG3`** at the end: exit **0**.
- **Not run by this task:** e2e (Playwright). The assignment's acceptance list does not include it, and I changed no web code and no response shape. The only response changes are the 500 for an unreachable database backstop and the extra work-item rows.

## 5. Operations routed (pending-list delta)

**None.** I added no route and removed nothing from any `p4-pending-*` list. The P4 pending lists are unchanged. `contract.test.ts` and its media-type pin are unchanged, so the pin delta is **0**.

## 6. Contract, ADR and schema needs (for the orchestrator and ARCH-R1)

1. **ADR-0025 §4** should describe the two new tasks-module services:
   - an item follows its source's due date and owner;
   - a returning owner's new item is keyed `<dedupe key>#n` (the first free n ≥ 2), because the 0028 guard keeps keys immutable and never reopens an item;
   - the new audit action `work_item.reschedule`, with the changes `{ due_date }`;
   - a reassignment's cancellation is `work_item.cancel` with reason `reassigned`.

   The ADR dedupe-key texts of ADR-0031 §4/§5.6, ADR-0033 and ADR-0032 §6 should note the `#n` variant.
2. **ADR-0031 §11 database mappings:** the line "`corrective_case_one_open_key` → 409 `corrective_case.already_open`" is no longer true as built. The mapper now answers 500, because `createCorrectiveCase` decides the rule in its insert and names the code. The refusal the client sees (409, code, text with the real `CA-nn`) is unchanged and still exactly §11's. This was the assignment's first option for item 6.
3. **ADR-0025 §4's `work_item.system_managed` text** ("This task closes automatically when its approval is decided.") now also answers for a corrective follow-up, which closes with its case, not with an approval. I kept the ADR text exactly (S-11). ARCH-R1 may want a subject-neutral text, such as "This task closes automatically with its record.", and the EN/AR keys.
4. **No migration** is needed for any item.

## 7. What remains

- Nothing from items 1 to 6. All six are delivered and proved (§2), and every acceptance check exited 0 (§3, §4).
- **Not mine (unchanged):** the approval service's in-transaction resubmit and withdraw (ARCH-R1, then BE-R2), and every contract or ADR change (§6 lists the texts ARCH-R1 should update).
- **Worker adoption:** no worker job changes a source's owner or due date today; the corrective and below-trajectory consumers only create. So the worker twins are exported and parity-tested, but no handler calls them yet.

## 8. Merge instructions

- No migrations.
- **Expect conflicts in `server.ts`** (the import block at about lines 72–80) if another branch touches the workflows imports. Keep a single import from `./modules/workflows/index.ts`.
- **Expect conflicts in `db-errors.ts`** only on the `corrective_case_one_open_key` case.
- `tasks/service.ts` and `worker/src/kit.ts` only gain appended blocks.
- The integration count rises by **12** tests: work-items +3, actions +1, corrective cases +3, interventions +1, executive decisions +1, and the two new files +1 and +2.
