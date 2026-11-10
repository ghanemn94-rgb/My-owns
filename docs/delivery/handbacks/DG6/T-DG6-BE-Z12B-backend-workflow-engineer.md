# Handback T-DG6-BE-Z12B (backend-workflow-engineer): work items, My Work and automation conditions (F-DG6-480, second half)

- **Stage:** DG6, FIXING after review round 7. Task T-DG6-BE-Z12B (the second half of T-DG6-BE-Z12). Finding F-DG6-480 (Medium, REQ-S10-002). Decisions D-218, D-219, D-222.
- **Invocation:** `DG6-T-DG6-BE-Z12B-backend-workflow-engineer-20261108T104420Z-7e16ba6c`, session `7e16ba6c-969f-4898-ac52-a0049a53f1a7`.
- **Assignment:** `/home/user/My-owns/docs/delivery/assignments/DG6/T-DG6-BE-Z12B.md`, sha256 `841ac59d…909a93` (checked at the start).
- **Base:** branch `dg6/be-z12b` at `6347e08a94fad454115c05bb7adf4ff89465efbc`. The tree was clean at the start. All changes are **uncommitted**, as asked.
- **Times:** start `2026-11-08T10:44:31Z`; end: see the last line of this file.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` exited 0 (`PASS gate DG5 (historical)`) at the start (`validate-dg5-start.log`) and at the end (`50-validate-dg5-end.log`).
- **Product gates:** marking a record sensitive or granting access is an access decision, never a business approval. The demo Sponsor decision in the new test approves nothing real. Nothing here grants or implies G1–G6, and nothing touches DG0–DG7. All test data is SYNTHETIC.

Logs are under `docs/delivery/handbacks/DG6/T-DG6-BE-Z12B-evidence/`.

## Requirement row

**REQ-S10-002**, acceptance (quoted): "A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant".

The rule applied, D-218 (quoted): "a response never names the id of a sensitive record the reader is not admitted to. The reference is omitted; where the open record depends on it, a neutral restricted marker without an id is returned, `includesRestrictedRecords: true` is set, and the screen shows the restricted label instead of a link."

D-222 decides the two open rows (quoted in part): "(1) … a restricted item returns `subjectId: null`, `recordId: null`, a link to the transformation home and `includesRestrictedRecords: true` (BE-Z4's kept ids are superseded). (2) `automation_rule_version.conditions`: a literal that names a sensitive record the reader is not admitted to is replaced by the neutral restricted marker on read, `includesRestrictedRecords: true` is set, the screen shows the restricted label on that condition, and a re-save keeps the hidden literal unchanged".

## 1. Item 1: work items and My Work (D-222 (1))

**Which items are restricted.** The new helper `restrictedWorkItems` (`apps/api/src/modules/tasks/deep-links.ts`) makes one reach decision per batch. An item is restricted for its reader, **assignee included**, when any of these names a record the reader is not admitted to (a sensitive benefit, business case or evidence item, or a `SENSITIVE_CHILD_SOURCES` child):

- its subject `(subject_type, subject_id)`;
- the corrective case or transition decision its stored link names (BE-Z4's rule);
- the benefit, business case or evidence route its stored link names (new; a link can name the record directly).

**What a restricted item shows.**

| Response | Before (BE-Z4) | Now |
|---|---|---|
| `listMyWorkItems`, `getWorkItem` | ids and link kept; text `inbox.restricted` | `subjectId: null` (type kept), `linkPath` = `/transformations/{id}` (or `/my-work` for an item outside any transformation), text `inbox.restricted`, `periodLabel: null`, `includesRestrictedRecords: true`. The item's own id, status and version stay. |
| `completeWorkItem` | the response was **not redacted at all** (`toWorkItem(row)`) | completion works for the assignee as before (If-Match, audit `work_item.complete`); the response is redacted as the reads are |
| `getMyWork` (every section, the upcoming deadlines) | `recordId` and `href` kept; text redacted | `recordId: null`, `href` the transformation home, text `inbox.restricted`, `code: null`, `includesRestrictedRecords: true` |
| `getMyWork` cursor | the cursor's last key was the `recordId` (the cursor is base64url JSON: decodable) | for a restricted item, the last key is its **work-item id**, so the cursor never carries a hidden record id. Other items keep `recordId`, so their order is unchanged. |
| `getWorkspaceHeader` `nextActions` (found by me, not in the inventory row) | the same My Work items, with **no** redaction (not even BE-Z4's text) | the same redaction as My Work (`presentWorkItems`, shared) |

**Contract (please confirm, §5).** `WorkItem.subjectId` and `MyWorkItem.recordId` are now `NullableUuid` (still required), each with an optional `includesRestrictedRecords` (`const: true`). This is in `docs/api/openapi.yaml` and the zod mirrors (`packages/shared/src/schemas/tasks.ts`, `dashboards.ts`).

**SPA (en and ar).**

- My Work rows no longer key on `recordId`. The new `myWorkRowKeys` (`MyWorkSections.tsx`) gives each row a unique key; a row without a record id is keyed by its position among the restricted rows. It is used by the deadlines list, the section table (`getRowId`), the home "at a glance" lists (`HomeRegions.tsx`) and the workspace header's next actions (`WorkspaceHeader.tsx`).
- A restricted row shows the existing restricted label, `RestrictedRecordsLabel` ("Includes restricted records" / "يشمل سجلات مقيدة"), next to its link. The link text is the existing `inbox.restricted` message ("You no longer have access to this item." and its Arabic text), and the link goes to the transformation home.
- `WorkspaceHeader.tsx` is not named in the assignment. It renders the same `MyWorkItem`s keyed by `recordId`, so two restricted next actions would have collided. I changed only its key and added the label.

## 2. Item 2: automation rule conditions (D-222 (2))

**The marker.** `AUTOMATION_RESTRICTED_LITERAL = "[restricted]"` (`packages/shared/src/schemas/automation.ts`). It is a neutral string and names no record. A string marker fits the existing `AutomationRuleContent` value type (a string up to 500 characters) in both directions, so the request schema and the builder's round trip do not change.

**Read** (`redactConditionLiterals`, `automation/versions.ts`). It makes one policy decision per batch with `restrictedIdsAmong`, so child types are covered too.

- A condition literal (a string value, or one element of an `in` list) that contains the id of a record the reader is not admitted to is replaced **in place** by the marker. The condition, its operator and the list positions stay, so the rule is still seen to test something.
- The version carries `includesRestrictedRecords: true`.
- The readable summary shows "a restricted record" / "سجل مقيد" instead of the marker.
- The stored conditions, `contentSha256` and the audit trail are unchanged.

It applies to every response that serializes a version: list, get, create, update, submit, review, publish and discard.

It also applies to **the rule's own summary** (`AutomationRule.summary`, from the effective version, `rules.ts`). That summary rendered the literal in en and ar, so the rule list, get, create, update, enable and disable responses leaked the id. They are now redacted, with the same marker.

**Re-save** (`keepRestrictedLiterals`, called by `updateAutomationRuleVersion` before validation). If the request sends the marker back in a condition with the same field and operator as one of the stored version (the k-th such condition of the request against the k-th stored one), at the same list position, and the stored literal there is one the writer is shown as the marker, the stored literal is kept unchanged. A marker with no hidden literal behind it is stored as an ordinary literal: it names nothing and matches no id. A writer admitted to the record never sees the marker and edits the literal freely. A writer can only bring back literals of the version being edited. The restore never takes an id from anywhere else.

**Screen (en and ar).**

- On the rule page's content view (`RulePage.tsx`) and in the builder (`ContentEditor.tsx`), a condition whose value is, or contains, the marker shows `RestrictedRecordsLabel`.
- The builder sends the marker back unchanged (`toContentBody`), so a re-save from the screen keeps the hidden literal.

**Contract.** `AutomationRuleVersion` and `AutomationRule` gain an optional `includesRestrictedRecords` (`const: true`). The marker is described on the condition `value`. The zod mirrors are updated.

## 3. Item 3: the six PENDING rows, seeded and tested

Each test seeds its own data: a fresh world, its own benefit, decision, review, instance and rule. The "before" runs disable **only that row's redaction**, because the redaction code itself was merged by BE-Z12 before this task (patch: `02-before-run-mutation.patch`, reversed afterwards; no `BEFORE-RUN MUTATION` line remains in `apps/api/src`).

| Row | Seeded by | Not-admitted reader sees | Admitted reader | Before | After |
|---|---|---|---|---|---|
| `approval.subject_id` | `draftDecision` + `decideDecision` (BO submits, the SP decides; demo data) before the benefit is marked | SP: `getApproval` and `listMyApprovals` show `subjectId: null`, type `benefit_transition_decision`, marked; AUD: `listApprovalDecisionRecords` names neither id | TO sees the decision id | **fails** (`02`) | passes (`03`) |
| `sustainment_review.transition_decision_id` | an approved decision's monitoring review, inserted as the worker job inserts it, with its audit event | TL and AUD: the review is listed with `transitionDecisionId: null`, marked | TO sees the id | **fails** | passes |
| `procedure_instance.subject_record_id` | `scope_target_change` launched by BO (the owner) with `subjectRecordType: benefit`, `subjectRecordId` = the benefit | TL: `subjectRecordId: null` (type kept), marked, in get and list | BO sees it | **fails** | passes |
| `procedure_instance.input_values` | the same instance, `inputValues.reason` = the benefit id | TL: `reason: null`, marked | BO sees it | **fails** | passes |
| `inherited_record.evidence_id` | a Modular transformation's inherited evidence record; the TO then marks the evidence sensitive (`modular.test.ts`) | AUD: listed and got with `evidenceId: null`, marked | TO and TL (creator and owner) see it | **fails** | passes |
| `revision_proposal.validation_report` | a synthetic formula proposal inserted as the starter inserts it (append-only, with its audit event), whose report names the sensitive benefit in an error entry and a member | AUD: the entry is dropped, the member is null, marked | the creator sees the report as stored; the stored report is unchanged | **fails** | passes |

**Note on `revision_proposal.validation_report`.** No writer at HEAD puts a record id in a validation report. A formula revision stores its engine version, result type and expression errors; a configuration revision stores its check-run ids. The row could be classified `cannot-name`. It stays `redacted`, because the read redaction exists and is now tested against a seeded report.

## 4. Item 4: the inventory pins zero open and zero PENDING rows

- `KNOWN_OPEN` and `KNOWN_PENDING` in `sensitive-reference-inventory.test.ts` are now both `[]`.
- `work_item.subject_id` and `automation_rule_version.conditions` are `redacted`, each with its exercise. Their operation lists now include `getWorkspaceHeader` and the automation rule and version operations.
- The six formerly PENDING rows point at their tests.
- The inventory test passes. Its log line: `redacted=48 holder-restricted=49 cannot-name=91 D-219=2 not-served=6 own-input=3` (no `open`, no PENDING). The catalog is unchanged: `fk=54 uuid=59 json=84 array=2`.

## 5. Contract, schema and dependency needs (for the orchestrator)

**Type widening (please confirm).** `WorkItem.subjectId` and `MyWorkItem.recordId` change from `Uuid` to `NullableUuid` (still required). D-222 states this. The SPA was updated in the same change. Other consumers of these fields:

- The e2e and QA suites. The QA integration files that read `me/work`, `work-items` or `summary` all passed (§8, row 7).
- Anything that keys on `recordId`. In the SPA, only the three components above did.

**Additive optional members** (`includesRestrictedRecords`, `const: true`):

- `WorkItem`
- `MyWorkItem`
- `AutomationRuleVersion`
- `AutomationRule`

**New shared constant:** `AUTOMATION_RESTRICTED_LITERAL`.

**Everything else:**

- `pnpm openapi:lint` passes (932 operations). I did not bump the contract version string.
- **Migrations:** none. The highest on the branch is still `0126`.
- **Dependencies:** none.
- **Operations routed:** none. Every change modifies existing operations. Delta to my `p6-pending-*.ts` list: **none**.

**Disclosure: a write-side observation, as in BE-Z12's procedure subject.** Condition literals are free text, and no write checks their existence for any id, so a hidden id is accepted exactly like an unknown one. A writer who types a uuid that happens to be a hidden record's id is then shown the marker on read. That tells them the id names a restricted record. BE-Z12 accepted the same trade-off for `procedure_instance.subject_record_id` (its handback §3, last row). Guessing a UUIDv7 is not practical, and the writer must already hold the id. Refusing such a write as an unknown id would need a new 422 on a free-text field. I did not add one. **Decision needed only if the owner wants it.**

**ADR text for the architect** (ADR-0051 §2; their file, which I did not edit):

1. D-222 (1): a work item about a restricted record has `subjectId`/`recordId` null, links to the transformation home and carries the marker, assignee included. This covers the completion response and the workspace header's next actions. The My Work cursor uses the work-item id for such an item.
2. D-222 (2): a restricted condition literal is shown as `"[restricted]"` in place, with the marker and the neutral summary phrase. The rule's summary is redacted the same way. The re-save rule matches by (field, operator, order, position).

## 6. User-facing texts

- No existing en/ar string became untrue. I checked the My Work, dashboard and automation catalogues for claims that every item links to its record, or that conditions are always shown in full.
- New user-visible text comes only from existing keys (`access.includesRestrictedRecords`, `myWork.message.inbox__restricted`) and the server's summary phrase "a restricted record" / "سجل مقيد". That phrase is generated in the API like the rest of the summary; it is not a catalogue key.

## 7. Tests

**New or changed integration tests:**

- `apps/api/test/integration/access/sensitive-reach-registers.test.ts`, as follows.
  - New: "D-222 work item ids: BO2's restricted work items, My Work items and next actions name no record id". It checks the list, the item, every My Work section and its limit-1 cursor pages (the decoded cursor too), the workspace header, and completion by the assignee (status `done`, version +1, one audit event, the stored subject unchanged).
  - BE-Z4's negative test now finds My Work items by their marker, since they have no `recordId`.
  - The positive test checks that the ids and the record link come back after a grant.
- `apps/api/test/integration/access/sensitive-reference-pending-z12b.test.ts` (new, 7 tests): the control; approval; sustainment review; the procedure instance; and automation conditions (the read, the re-save, and after a grant).
- `apps/api/test/integration/reporting/modular.test.ts`: the inherited evidence test.
- `apps/api/test/integration/methodology/revision-proposals.test.ts`: the validation report test.
- `apps/api/test/integration/access/sensitive-reference-inventory.test.ts`: empty pins.

**Web tests (unit-web, en and ar):**

- `apps/web/src/pages/my-work/home-regions.test.tsx`: two restricted rows render in the glance list, the deadlines and the section table. Each has the label and the home link, and there is no React duplicate-key warning.
- `apps/web/src/pages/automation/fed.test.tsx`: a restricted condition shows the label (en, ar), and the builder sends the marker back in place.

**Before and after logs:**

| Log | What | Result |
|---|---|---|
| `01-before-fix-items-1-2.log` | my `apps/api/src` diff reversed (`git apply -R`), the registers and Z12B files | exit 1: **4 failed**, 9 passed. The failures are BE-Z4's negative test (its My Work items carry no marker yet), the D-222 test, and the two automation read and re-save tests. The approval, review and procedure tests pass here because their redaction is BE-Z12's code, not reversed in this run. |
| `02-before-fix-pending-rows.log` | the five BE-Z12 redaction calls disabled (`02-before-run-mutation.patch`), the Z12B, modular and revision files | exit 1: **5 failed** (approval, sustainment review, procedure instance, inherited record, validation report), 24 passed |
| `03-after-fix-new-tests.log` | all five integration files, final code | exit 0: **37 passed** |
| `05-before-fix-web.log` | my web source diff reversed (tests kept) | exit 1: **5 failed**, 29 passed. The marker round-trip test fails with a TypeError, because `conditionIsRestricted` does not exist before the change. |
| `06-after-fix-web.log` | the two web files and `pages/dashboards` | exit 0: **9 files, 166 passed** |

## 8. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. PostgreSQL is a disposable cluster from `tests/qa/support/with-pg.sh`, on ports 31100–31149 only.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` (start, end) | 0, 0 | `PASS gate DG5 (historical)` | `validate-dg5-start.log`, `50-validate-dg5-end.log` |
| 2 | Before-fix and after-fix runs (§7) | 1, 1, 0, 1, 0 | as expected (§7) | `01`, `02`, `03`, `05`, `06` |
| 3 | `with-pg.sh npx vitest run --project integration` on `access/` (sweep, inventory, registers, Z10/Z10B/Z12/Z12B), `tasks/`, `reporting/my-work`, `reporting/workspace-header`, `automation/`, `operations/` (operational exceptions, `exception-recurrence-race` = the BE-Z6 race test), `jobs/` (job operations), `approvals/`, `contract/contract`, `procedures/`, `sustainment/`, and the worker's `job-runs`, `worker-attempt`, `automation-failure-queue`, `connector-failure-exception`, `operations-freshness`, `starters` | 0 | **79 files, 700 tests passed** (449 s) | `04-integration-touched.log` |
| 4 | `with-pg.sh npx vitest run --project integration <28 QA files>`: every `tests/qa/integration` file that reads `me/work`, `work-items`, `automation-rules`, `summary` or `recordId`, plus every `a13-*` (automation recovery, job idempotency, kill-restart) and `a22-*` file | 0 | **28 files, 279 tests passed** (569 s) | `07-qa-integration.log`, list `07-qa-integration-files.txt` |
| 5 | Re-run on the **final** tree (after the architecture fix, row 9): `access/`, `automation/`, `reporting/my-work`, `workspace-header`, `modular`, `methodology/revision-proposals`, `tasks/`, `contract/contract`, the worker's `automation-failure-queue`, and the QA `a13-durable-automation` and `a13-dependency-slip-rule-b` | 0 | **45 files, 455 tests passed** (347 s) | `08-integration-rerun-final.log` |
| 6 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE`) | 0 | unit-node: 190 files, **2899 passed**; unit-web: 123 files, **2082 passed**; unit-formula-nocodegen: 3 files, **259 passed, 2 skipped** (pre-existing skips) | `20-pnpm-test-locale-unset.log` |
| 7 | `pnpm test`, `LANG=LC_ALL=C.UTF-8` | 0 | the same counts as row 6 | `21-pnpm-test-c-utf8.log` |
| 8 | `E2E_PG_PORT=31140 E2E_API_PORT=31145 MTH_PORT_POOL=31140-31149 apps/web/e2e/support/with-stack.sh npx playwright test e2e/a22-p6-operability.spec.ts e2e/a13-automation-recovery.spec.ts --workers=1 --project=chromium-en --project=chromium-ar` (real stack: built API, SPA and worker, from the final build) | 0 | **4 passed** (a13: en 7.1 s, ar 7.0 s; a22: en 1.9 m, ar 1.8 m) | `40-e2e-a22-a13.log` |
| 9 | `pnpm -r typecheck` | 0 | all packages done | `10-typecheck.log` |
| 10 | `pnpm -r build` | 0 | done | `13-build.log` |
| 11 | `pnpm lint` | 0 | clean (`--max-warnings=0`) | `11-lint.log` |
| 12 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | no `[warn]` line in any batch | `12-prettier.log` |
| 13 | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations` | `14-openapi-lint.log` |

**Non-zero exits and corrections during the work** (each fixed and re-run; none was flaky, and none timed out):

- **The first `pnpm -r build` exited 2** (`13a-build-first-run-ts4111.log`). My new web test read `toContentBody(draft).conditions` from an index signature (TS4111). I fixed it to `["conditions"]`. Row 10 is the re-run. `pnpm -r typecheck` had passed before that test existed.
- **The first two `pnpm test` runs failed 2 tests each** in both locales (`20a-…`, `21a-…`): `architecture.test.ts` and `reporting.test.ts`. Four computed member accesses with a non-literal key (`x[i]`) in `automation/rules.ts`, `automation/versions.ts` and `reporting/my-work.ts` bypass the module-interface check. BE-Z12 met the same rule. I rewrote them as `.at(i)`, which is behaviour-neutral. Rows 6–7 are the re-runs, and rows 5, 8–13 ran on that final tree. Rows 3 and 4 ran before this rewrite, on code that differs only in those four expressions.
- **The first prettier check** was read through `| tail`. That cut the output of several `xargs` batches, so the "All matched files" lines it showed did not cover a `[warn]` for `automation/versions.ts`. I formatted my three unformatted files and re-ran the check into a log with its exit code (row 12). That log has no `[warn]` line.
- **Development runs** I deleted: `scratch-registers.log`, `scratch-pending.log` and `scratch-mod-rev.log` were my first green runs of the new tests, superseded by `03`. Before-run sandbox note: `git checkout` of the mutated files was refused (the worktree's git index is read-only in this sandbox), so I reversed the mutation with `git apply -R 02-before-run-mutation.patch`, and checked that no mutation line remains.
- **e2e budgets:** I added no e2e spec, so the budget rule does not apply.

## 9. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/tasks/deep-links.ts` | `restrictedWorkItems` (subject + link reach decision), `restrictedWorkItemLink` |
| `apps/api/src/modules/tasks/routes.ts` | work-item list, get and complete: ids null, home link, marker |
| `apps/api/src/modules/tasks/index.ts` | exports the two helpers |
| `apps/api/src/modules/reporting/my-work.ts` | `presentWorkItems`; cursor tie-break by work-item id for restricted items |
| `apps/api/src/modules/reporting/workspace-header.ts` | next actions through `presentWorkItems` |
| `apps/api/src/modules/automation/versions.ts` | `redactConditionLiterals`, `keepRestrictedLiterals`, neutral summary phrase, principal-aware presenters |
| `apps/api/src/modules/automation/rules.ts` | the rule summary from the redacted effective conditions, plus the marker |
| `apps/api/src/modules/automation/lifecycle.ts` | passes the principal to the version presenter |
| `packages/shared/src/schemas/tasks.ts`, `dashboards.ts`, `automation.ts` | zod mirrors: nullable ids, markers, `AUTOMATION_RESTRICTED_LITERAL` |
| `docs/api/openapi.yaml` | `WorkItem`, `MyWorkItem`, `AutomationRuleVersion`, `AutomationRule`, the condition value description |
| `apps/web/src/pages/dashboards/MyWorkSections.tsx` | `myWorkRowKeys`, `MyWorkRestricted` label; deadlines and table keys |
| `apps/web/src/pages/my-work/HomeRegions.tsx` | glance list keys and label |
| `apps/web/src/components/WorkspaceHeader.tsx` | next-action keys and label |
| `apps/web/src/pages/automation/ContentEditor.tsx` | `conditionIsRestricted`; label in the builder |
| `apps/web/src/pages/automation/RulePage.tsx` | label on a restricted condition in the content view |
| `apps/api/test/support/sensitive-reference-inventory.ts` | rows redacted and exercised; operations widened |
| `apps/api/test/integration/access/sensitive-reference-inventory.test.ts` | pins zero open and zero PENDING rows |
| `apps/api/test/integration/access/sensitive-reference-pending-z12b.test.ts` (new) | the PENDING rows and automation conditions |
| `apps/api/test/integration/access/sensitive-reach-registers.test.ts` | D-222 work-item test; BE-Z4 assertions updated |
| `apps/api/test/integration/reporting/modular.test.ts` | the inherited evidence test |
| `apps/api/test/integration/methodology/revision-proposals.test.ts` | the validation report test |
| `apps/web/src/pages/my-work/home-regions.test.tsx`, `apps/web/src/pages/automation/fed.test.tsx` | web tests (en, ar) |

## 10. What remains

- Nothing of the assignment's four items. The inventory pins zero open and zero PENDING rows.
- **For the orchestrator:**
  - confirm the two type widenings (§5);
  - optionally decide the write-side observation (§5);
  - pass the ADR text to the architect.
- The full `pnpm test:integration` was not run, as the assignment allows. The orchestrator runs it on the merged tree.

## 11. Merge instructions

- No migration and no new dependency.
- Expect conflicts only if another branch touched the same lines of `sensitive-reference-inventory.ts`, `tasks/routes.ts`, `reporting/my-work.ts` or the automation presenters.
- Rebuild `@mth/shared` before the API and web (new exports).

End: `2026-11-08T11:56:03Z` (`date -u`).
