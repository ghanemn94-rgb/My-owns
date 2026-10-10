# Handback T-DG4-BE-R3 (backend-workflow-engineer): P4 repair scope round 3

- **Stage:** DG4 (BUILDING). Worktree `/home/user/wt/dg4-be-r3`, branch `dg4/be-r3`, base `HEAD` `7dd77b5650a7fd15c0e15483f72ec6c8e6f36df8` ("DG4: W15 assignments BE-R3, KBE-R3, FE-R1, FE-E"). The changes are **uncommitted**, for the orchestrator to integrate.
- **Invocation:** `DG4-T-DG4-BE-R3-backend-workflow-engineer-20261010T030942Z-a51dde73` (session `a51dde73-200f-4937-a3d8-cc7c373d6e1b`). I checked the assignment's sha256 `1071e127656d1f95c49fc42ade957c5afb095e06f9668b30540e7df1b8204306` with `sha256sum` before starting.
- **Time:** start `Sat Oct 10 03:09:54 UTC 2026`, end `Sat Oct 10 04:25:30 UTC 2026 (about 76 minutes)` (`date -u`).
- **Preceding gate:** I ran `node tools/gates/validate.mjs --historical --stage DG3` first, before any edit. It printed `PASS gate DG3 (historical)` and exited 0. §3 has the re-run at the end.
- **Two gate systems.** Product gates G1–G6, the Modular G3 waiver and every gate exception are business approvals inside the product. Every one of them in these tests is a synthetic demo decision by a test person and approves nothing real. Nothing here reads or writes the DG0–DG7 records, apart from this handback and its evidence. Product G6 never implies DG7. The narrowed G6 test (item 6) still asserts exactly that.
- **Ports, disk, locale.** Integration used ports 25300–25349 only. `df -h .` showed 20 GB free before each full run (D-104). Unit tests ran with the locale unset and with `C.UTF-8`.
- **Untracked files I did not create:** `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc` and `CLAUDE.local.md`. They were present at the start, and I left them untouched.
- **The write guard's empty `apps/api/src/modules/.claude/` directory.** It reappears after Write/Edit calls, and it fails `architecture.test.ts` ("has only mapped module directories": `[".claude"]`). I removed it with `rmdir` before every test run. The orchestrator should check it is absent before the merged-tree run.

## 0. Production wiring (D-107)

Nothing here depends on `server.ts`. Every new route is registered inside an existing module's register function (`registerModularRoutes`), which the composition root already calls. `modular.test.ts` › "T-DG4-BE-R3 (D-107): the real server built by the harness registers getInheritedRecord with no hand wiring" builds the real server through `startApi()` (`buildServer`). It asserts the route is in `api.routes` with access `transformation.read`. Every other new test also goes through `startApi()`, and none wires anything by hand.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/portfolio/dispensations.ts` | Item 1, ADR-0021 W1: the one changed condition, plus a comment. Nothing else. |
| `apps/api/src/modules/workflows/gates.ts` | Item 1, ADR-0038 B1: `assertModularLinks` adds `ORDER BY expires_on DESC, id DESC` and returns the waiver used; `submitGate` adds the snapshot member `modularLinks` (after `evidence`, before `note`) only when a waiver let the submission through; `decideGate` step 5b runs `assertRecordedModularWaiverInForce` (approve only, after `assertRecordedExceptionsUnexpired`); `gateModularWaiverRevoked`/`gateModularWaiverExpired` use `problems.businessRule` |
| `packages/shared/src/schemas/missing-links.ts` | Item 1: `modularWaiverRevokedDetail(date)` and `modularWaiverExpiredDetail(date)`, the exact ADR-0038 B4 texts, next to `MODULAR_LINKS_MISSING_DETAIL` |
| `apps/api/src/modules/reporting/modular.ts` | Item 2: the route `GET …/inherited-records/{inheritedRecordId}` (`getInheritedRecord`). Item 7: `openModularWrite`, which runs the read gate on the request-start grants first, then `openWrite(…, { atCommit: true })` |
| `apps/api/test/support/p4-pending-arch-r2.ts` | Item 2: `getInheritedRecord` removed from `P4_PENDING_ARCH_R2` |
| `apps/api/test/integration/contract/p4-exercises-be-m.ts` | Item 2: mirror `getInheritedRecord: inheritedRecord`. It is exercised in the BE-M2 section: the `Location` resolves (active and withdrawn, `ETag`); a `prior_approval` id, an unknown id and an outsider get 404 |
| `apps/api/src/modules.ts` | Item 3: `governance.dependsOn` gains `"raid"`, with a comment (ADR-0032 G1) |
| `apps/api/src/modules/raid/actions.ts` | Item 3: `insertActionItem(ctx, link \| null, body)` extracted. `createLinkedAction` = `assertActiveUsers` + `insertActionItem` + `assignActionTask`, with the same order, rows and events. Item 4: `updateAction` calls `followMeetingActionWorkItem` |
| `apps/api/src/modules/raid/index.ts` | Item 3: exports `insertActionItem`, `ActionInsertContext` and `ActionItemInsert` |
| `apps/api/src/modules/governance/meeting-actions.ts` | Item 3: the copied insert and audit call (and the `actionFields` helper) are replaced by `insertActionItem(…, null, …)`. Its owner check and refusal, its link row and its `meeting_action_due` task stay. The kind, key and dedupe key come from `MEETING_ACTION_TASK` |
| `apps/api/src/modules/tasks/meeting-action-follow.ts` (new) | Item 4: `followMeetingActionWorkItem(tx, actor, before, after)` (reassign, reschedule, close through BE-R1's services) and `MEETING_ACTION_TASK` |
| `apps/api/src/modules/tasks/index.ts` | Item 4: exports both |
| `apps/api/src/modules/transformations/register-kit.ts` | Item 4: optional `RegisterSpec.afterUpdate(before, after, ctx)`, called in the update transaction after the row's audit event. Absent → nothing changes |
| `apps/api/src/modules/workflows/design-registers.ts` | Item 4: `actionItemRegister.afterUpdate` calls `followMeetingActionWorkItem` (the DG2 `/actions` PATCH path) |
| `apps/api/src/modules/tasks/routes.ts` | Item 5: `taskRefusals.systemManaged` text (ADR-0025 D3) |
| `apps/api/src/modules/tasks/tasks.test.ts`, `apps/api/test/integration/tasks/work-items.test.ts`, `apps/api/test/integration/raid/corrective-cases.test.ts` | Item 5: the three pins of the old text |
| `apps/api/test/integration/workflows/g5-g6.test.ts` | Item 6: `deliveryTree()` hashes only `DELIVERY_RECORDS` (§2 item 6) |
| `apps/api/test/integration/reporting/modular.test.ts` | Item 7: the outsider-403 expectation becomes a separate 404 test for create and withdraw. Items 2 and D-107: two new tests |
| `apps/api/test/integration/workflows/modular-waiver.test.ts` (new) | Item 1: the W7 item 4 tests, plus the Modular-refusal A/B transcript |
| `apps/api/test/integration/governance/meeting-action-follow.test.ts` (new) | Items 3 and 4: the row and audit equality, the A/B transcript, and the follow tests on both paths |
| `apps/api/test/support/response-transcript.ts` (new) | BE-M2's A/B recorded-response method as a reusable, opt-in wrapper (env var; no-op when unset) |
| `apps/api/test/integration/portfolio/dispensations.test.ts` | Item 1: (a) opt-in transcript wrapper around `call` (`MTH_BE_R3_DISPENSATION_TRANSCRIPT`); (b) **one assertion changed**, because it pinned the very case W1 changes (§2 item 1, "DG3 test line") |
| `apps/api/test/integration/workflows/modular-precondition.test.ts` | Comment only: the `waiverRow` doc comment no longer says the route refuses Modular G3 waivers |
| `apps/api/src/architecture.test.ts` | Item 3: governance may import raid; raid may not import governance (planted import → violation); the reverse edge would close a cycle |
| `docs/delivery/handbacks/DG4/T-DG4-BE-R3-backend-workflow-engineer.md`, `…/T-DG4-BE-R3-evidence/**` | This handback and its logs and transcripts |

**No migration.** None was needed. `gate_dispensation` has no mode check, and no CHECK or trigger reads snapshot members (ADR-0021 W1, ADR-0038 B1). **No contract change:** the operation count stays 649, and the media-type pin is unchanged (delta 0), because `getInheritedRecord` is a GET with no body.

## 2. Behaviour delivered, item by item

### Item 1. Modular G3 waiver (D-110; ADR-0021 W1–W7; ADR-0038 B1, B4). Rows REQ-PB-005, REQ-S03-005

Binding acceptance texts:
- **REQ-PB-005 (A03):** "a transformation entering at Design with no baseline and no outcome links shows both as missing and G3 submission is rejected by the API until they are supplied or an authorized waiver exists".
- **REQ-S03-005 (A03):** "… a missing baseline and outcome link are flagged and G3 submission is rejected until supplied or waived".

What I built:
- **W1.** `if (t.mode !== "end_to_end" && !(body.gateCode === "G3" && body.initiativeId === undefined))`. Every later check of the branch runs unchanged, in the same order.
- **B1, submission:**
  - When several waivers are in force, the one with the latest `expires_on` is used, ties broken by the greatest `id`.
  - `modularLinks: {missing, waiver: {dispensationId, expiresOn, reason, decidedBy}}` is written only when a blocking item exists **and** a waiver is in force. Otherwise the snapshot object is the DG3 one.
- **B1, approval** (outcome `approved` only, after step 5a): a recorded waiver that is revoked gives 422 `gate.modular_waiver_revoked`, with `{date}` = `p4_business_date(revoked_at, timezone)`. Otherwise, one with `expires_on <` `exceptionBusinessDate` gives 422 `gate.modular_waiver_expired`, with `{date}` = `expires_on`. Reject, request changes and defer are unaffected.

Proof (`modular-waiver.test.ts`, 13 tests):
1. **Modular G3, no links, accepted unexpired waiver → 201** ("criteria met, links missing, an accepted waiver in force → 201 with modularLinks in the snapshot; report unchanged"):
   - the exact `modularLinks` member;
   - `res.body.snapshot` equals the stored snapshot;
   - the `gate_submission.create` audit event's `changes.snapshotSha256` equals `gate_submission.snapshot_sha256`;
   - the missing-link report still lists both blocking items.
   - Also tested:
     - only the outcome link missing (`missing` lists it alone);
     - links supplied (no member);
     - which waiver (latest expiry; the tie goes to the greater UUIDv7 id);
     - approval with the waiver in force (201, G3 `approved`).
2. **Revoked or expired → the refusal:**
   - **At submission**, each of these gives 422 `gate.modular_links_missing` with the exact detail and `errors` `/baseline`, `/outcomes`, and the gate, submissions and decisions stay unchanged:
     - a pending waiver;
     - a rejected one;
     - a revoked one;
     - an expired one (by the injected exception clock, `setGateExceptionClock`).
   - **Inclusive expiry:** on the expiry date the submission is 201.
   - **At approval:**
     - revoked after submission → 422 `gate.modular_waiver_revoked` with the exact text and the revoke's business date; a waiver accepted later does not rescue the submission; nothing is written; reject is then 201;
     - expired by the clock → 422 `gate.modular_waiver_expired` with the exact text and the expiry date; nothing is written; on the expiry date itself the approval is 201;
     - revoked **and** expired → the revoke is reported;
     - a Modular G3 submitted with its links (no member) is decided as before, even if a waiver is revoked afterwards.
3. **W2:**
   - TL records it (201, pending, `gate_dispensation.create`);
   - the recorder TL cannot accept it (403);
   - BO gets 403 `gate.not_approver`;
   - AUD gets 403;
   - SP, G3's approver, accepts it (200, `decidedBy` = SP), audited `create` then `decide`;
   - no gate decision is written, and G3 stays `draft`.
4. **W1 refusals kept:**
   - G1, G2, G3 with an initiative, G1 with no reason, and G2 with an initiative all give 422 `dispensation.waiver_requires_end_to_end` with the DG3 text and `errors[0]` at `/kind`;
   - nothing is written;
   - the waiver branch's later checks still apply to a Modular-links waiver (`waiver_incomplete`, `expired`, AUD 403).

**Byte identity (W7 item 3; BE-M2's A/B method, extended to dispensation responses):**

- **Method:**
  - **Run A** is my tree.
  - **Run B** is the same tree with `dispensations.ts`, `gates.ts` and `meeting-actions.ts` replaced by `git show HEAD:…`. My files were restored afterwards and verified with `sha256sum -c` (all three `OK`).
  - Both runs use the same test selection (`-t` filter in `ab-commands.txt`): 10 tests, all passed, exit 0 (`ab-run-A.log`, `ab-run-B.log`).
  - Normalization replaces ids, instants and 64-hex hashes with first-appearance placeholders and keeps every other byte (`response-transcript.ts`, the BE-M2 normalizer).
- **Results (`cmp`):**

| Transcript | What it covers | Lines | Result |
|---|---|---|---|
| `dispensations.jsonl` | Every response of the DG3 dispensation tests (`dispensations.test.ts`, 7 tests): End-to-End waiver create, decide, revoke and list, inherited approvals, readiness, gate list and gate view, every refusal. Counts: 201×8, 200×8, GET 200×17, 422×13, 403×7, 428×2, 400×2, 409×1 | 58 | **BYTE-IDENTICAL** (sha256 `d48aa63d67cce9201484aaaa0039ddab734038a9df4acd0b9e33046b75baecec`) |
| `modular-refusals.jsonl` | The Modular refusals G1, G2, G3 with an initiative (plus G1 without reason, G2 with an initiative) and the list | 6 | **BYTE-IDENTICAL** (`59d0fdb4f7445ec41a755b8365355ccd8e7932f7560165ab5d6b8b07ed4ca563`) |
| `e2e-gates.jsonl` | BE-M2's 21 End-to-End G1–G4 gate responses (`MTH_BE_M2_TRANSCRIPT`) | 21 | **BYTE-IDENTICAL** (`be4f2daad11ae8acfecab410afd9c96db3a29982be2493e8914e2d21c0d28768`, the same hash BE-M2 recorded in D-110's evidence) |
| `meeting-action.jsonl` | Item 3 (below) | 8 | **BYTE-IDENTICAL** (`c0998f6aee074e31ce819bf8c39a37b64d2578b21a3505ba2a04c0ecfb9e3e49`) |

**The DG3 test line I changed** (`dispensations.test.ts`, inherited-approvals test):
- **What it asserted:** `expect((await create(p, waiver())).body.code).toBe("dispensation.waiver_requires_end_to_end")`. `waiver()` defaults to G3 with no initiative, on a Modular world. That is exactly the case ADR-0021 W1 (D-110 option a) turns into a Modular-links waiver (201), so the line had to change.
- **What it asserts now:** the same refusal for a G2 waiver and for a G3 waiver with an initiative. Both stay refused under W1. The new behaviour of the old case is tested in `modular-waiver.test.ts`.
- **Effect on the transcript:** the transcript includes these two lines in both runs, and they are identical.
- **This is the only DG3 response whose behaviour changes,** and it is the one ADR-0021 W1 specifies.

### Item 2. `getInheritedRecord` (ARCH-R2 item 3; ADR-0038 B3). Row REQ-S03-005

Binding acceptance text (REQ-S03-005, A03): "entering at Design with an inherited G2 approval document shows G2 as 'inherited' (not Approved) …".

- **The route:** `GET /api/v1/transformations/{transformationId}/inherited-records/{inheritedRecordId}`, permission `transformation.read`.
  - 200 `InheritedRecord` with `ETag` = version, for an active **or withdrawn** row.
  - 404 for anything else, including a `prior_approval` entry's dispensation id, an unknown id and an outsider.
  - 400 for a malformed id; 401 without a session.
- **Representation:** the same as create and list (`toInheritedRecord`).
- **Tests:** "T-DG4-BE-R3 getInheritedRecord …" in `modular.test.ts` (AUD, TL and BO read it; `Location` resolves before and after a withdrawal), plus the contract exercise.
- **Pending delta:** `P4_PENDING_ARCH_R2` goes from `["getInheritedRecord", "getBenefitPlanValue"]` to `["getBenefitPlanValue"]`.

### Item 3. Governance → RAID (ARCH-R2 item 6; ADR-0032 G1). Rows REQ-S16-018, REQ-S16-019

Binding acceptance texts:
- **REQ-S16-018 / REQ-S16-019 (A09):** "an integration test creates and reads each one through the API with authorization enforced".
- **REQ-S10-011 (A09):** "actions appear in owners' My Work".

- **The edge and the insert:** `governance.dependsOn` gains `raid`. `insertActionItem` is the one insert of an action and its `action_item.create` event. Governance calls it with `link = null`. Governance keeps:
  - its `isActiveUserOf` check → 400 `validation.user_unknown` at `/ownerUserId` (tested);
  - its link row;
  - its single `meeting_action_due` task.
- **Rows and audit unchanged:**
  - an explicit test: the full row, and the event's action, record type, versions, actor and `changes` (null-to-null fields omitted, as BE-F2's `diffFields` did), and exactly one task, with its key, message key, params and link path;
  - the A/B transcript (row, audit events without id, seq, instant or request id, and work items, for two inputs, one with a description and no due date): **BYTE-IDENTICAL** against the base `meeting-actions.ts`.
  - **Note:** jsonb stores keys in its own order, so the stored `changes` bytes are the comparable thing. The explicit test compares by value.
- **Existing tests:** BE-F2's `meeting-actions.test.ts` passes unchanged (targeted run, `targeted3.log`, and the full suite).
- **Boundary:** `architecture.test.ts` asserts:
  - the declared edge exists, and `raid` does not declare `governance`;
  - a planted `governance → ../raid/index.ts` import has no violation;
  - a planted `raid → ../governance/index.ts` import gives "module raid may not import module governance";
  - declaring the reverse edge closes a cycle;
  - the existing acyclicity test passes with the new edge.

### Item 4. Meeting-action My Work sync (BE-F2 handback §8 item 1). Row REQ-S10-011

Binding acceptance text (REQ-S10-011, A09): "actions appear in owners' My Work".

- **What follows the action.** A meeting action edited through `raid/actions.ts` (`PATCH …/action-register/{id}`) or the DG2 path (`PATCH …/actions/{id}`) now updates its `meeting_action_due` item:
  - **owner change:** `reassignWorkItemOfSubject`, which cancels the previous owner's item (reason `reassigned`) and opens the new owner's under `meeting.action:<id>:<newOwner>`. A → B → A gives `#2`.
  - **due-date change:** `rescheduleWorkItemsOfSubject` (`work_item.reschedule`, `changes.due_date`);
  - **done / cancelled:** `closeWorkItemsOfSubject` with that status.
- **Where the rule lives:** `tasks/meeting-action-follow.ts`. Both `raid` and `workflows` already depend on `tasks`, so no new module edge is added, and neither imports `governance`.
- **How a meeting action is recognised:** by the existence of its `meeting_action_due` item. So an action that never had one reads one row and is untouched.
- **The DG2 path** gets the hook through the new optional `RegisterSpec.afterUpdate`. Only `actionItemRegister` sets it, and the DG2 response is unchanged.
- **Tests** (`meeting-action-follow.test.ts`; each case on **both** paths):
  - owner change: the old item is `cancelled` with a `work_item.cancel` / `reassigned` event, the new owner's item is open with the same kind, message key, params and link path, it appears in the new owner's My Work (`status=open`) and not in the old owner's, and A → B → A gives one open item keyed `#2`;
  - due-date change: moved, with a `work_item.reschedule` event of `{from, to}`; owner and date together: the new owner's item carries the new date;
  - done → item `done`; cancelled → item `cancelled`; a title edit changes nothing; `in_progress` keeps it open;
  - a non-meeting DG2 action edited on both paths gets no item;
  - a refused edit (stale If-Match 409, AUD 403) moves nothing.

### Item 5. `work_item.system_managed` text (ADR-0025 D3)

- `taskRefusals.systemManaged` now says "This task closes automatically when the record it belongs to is decided or closed."
- The code, the status and the kinds are unchanged.
- The three test pins are updated. The web key `work_item__system_managed` is the FE task's (D3), and I did not touch it.

### Item 6. G6 test scope (ARCH-R2 handback)

- **What it hashes now.** `g5-g6.test.ts` hashes these paths under `docs/delivery/` before and after the SP's G6 approval:
  - `gates/**`
  - `stages.json`
  - `findings.json`
  - `reviews/**`
  - `decisions.md`
  - `requirements.csv`
- **Excluded:** `runs/**`, handbacks, assignments, test evidence, candidates, progress notes and the other docs.
- **The assertion is not vacuous.** It now also checks that the hashed set contains `stages.json`, `findings.json`, `gates/DG3.json`, `decisions.md` and `requirements.csv`, and no `runs/` path. A missing path is listed as `<path> missing`, never skipped.
- **The intent is unchanged:** a product G6 approval writes no DG record (M0412; G6 never implies DG7).

### Item 7. Outsider status consistency (BE-M3 handback §2.3 item 2)

- **The rule:** p4-work-split JK.10 item 3 ("an explicit id outside it is 404 (never 403 …)") and ADR-0038 §10 ("404 outside scope").
- **What changed:** `reporting/modular.ts` writes (create and withdraw) now use `openModularWrite`, the same order as `portfolio/structure.ts` `openWorkstreamWrite`. A cross-organization outsider gets 404 `not_found` on both. A right revoked while the request waited is still the commit-time 403 (the existing test passes).
- **Proof:** "T-DG4-BE-R3 (JK.10 item 3): another organization's TO gets 404 on create and withdraw, as on reads; nothing written", with the reads also 404, the row unchanged and the audit unchanged. The old 403 expectation was removed from the AUD/BO test, whose 403s for AUD, BO and SP stand.

## 3. Checks actually run

All in the worktree, Node 24.21.0, offline. Logs were kept in `$TMPDIR` during the suites and copied to `docs/delivery/handbacks/DG4/T-DG4-BE-R3-evidence/` afterwards.

Evidence paths are relative to `T-DG4-BE-R3-evidence/`.

| Check | Command | Exit | Result (log) |
|---|---|---|---|
| Historical DG3, start | `node tools/gates/validate.mjs --historical --stage DG3` | 0 | `PASS gate DG3 (historical)`, the first command of the run (`validate-dg3-historical-start.log`, transcribed and labelled so, because the folder did not exist yet) |
| Typecheck | `pnpm -r typecheck` | 0 | `typecheck.log` |
| Build | `pnpm -r build` | 0 | `build.log` |
| Lint | `pnpm lint` (`--max-warnings=0`) | 0 | `lint.log` |
| Format | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (`format.log`; run before the evidence and handback existed, so these were checked separately, last row) |
| OpenAPI | `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 649 operations` (`openapi-lint.log`) |
| Unit, locale unset | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | unit-node + unit-web: **126 files, 2403 passed**; unit-formula-nocodegen: **3 files, 259 passed, 2 skipped** (`unit-locale-unset.log`) |
| Unit, `C.UTF-8` | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts: 2403; 259 + 2 skipped (`unit-c-utf8.log`) |
| Integration | `QA_PG_PORT=25300 MTH_PORT_POOL=25301-25349 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **182 files, 1734 passed** of 1734, 1314 s (`integration.log`). Includes `contract.test.ts` (45 tests), `g5-g6.test.ts` with the narrowed check, and every DG2/DG3 gate and dispensation test. No failed, skipped, retried or flaky test |
| A/B byte identity | `ab/ab-commands.txt` (runs A and B, `sha256sum -c`, `cmp`) | 0 / 0 | the four transcripts are BYTE-IDENTICAL (§2 item 1 table); `ab/ab-run-A.log`, `ab/ab-run-B.log` (10 passed each); `ab/*.jsonl` |
| Historical DG3, end | `node tools/gates/validate.mjs --historical --stage DG3` | 0 | `PASS gate DG3 (historical)` (`validate-dg3-historical-end.log`) |
| Format of the handback and evidence | `npx prettier --check` on this handback and `ab/ab-commands.txt` | 0 | run last, on the final files (`format-handback.log`); the whole-tree check was then re-run with the handback and evidence present, exit 0 (`format-final.log`) |

**Count deltas (what I added; I did not measure the base commit's counts separately):**
- **Unit:** +1 test, the `architecture.test.ts` raid/governance case.
- **Integration:** +2 files and +26 tests:
  - `modular-waiver.test.ts`: 13;
  - `meeting-action-follow.test.ts`: 10 (3 cases × 2 paths, plus 4);
  - `modular.test.ts`: 3 (outsider 404, `getInheritedRecord`, D-107 route).
  - The changed `dispensations.test.ts` and `modular.test.ts` cases keep their test counts.
- **Pins:** no pinned count changed. The operation count is 649, the media-type pin is unchanged, and `contract.test.ts` has 45 tests.

**Non-zero exits and failures during the work** (all fixed; disclosed under the evidence rule):
1. **First targeted run** (`earlier-runs/targeted1.log`, exit 1): 4 of 36 failed, all test errors.
   - jsonb does not keep the key order of `changes`, so a `JSON.stringify` comparison was replaced by a value comparison. The A/B transcript compares the stored bytes.
   - My Work lists all statuses by default, so `status=open` was added.
   - Snapshot member order is not observable in jsonb (canonical JSON), so that assertion was removed.
   - The re-run passed 23/23 (`earlier-runs/targeted2.log`).
2. **First A recording run:** exit 1, the DG3 line described in §2 item 1. Fixed as described. That log was overwritten by the re-run.
3. **First B recording run:** exit 1, with 2 failures. My `-t` filter matched two new waiver tests by name ("waivers"), and these correctly fail on the base source. They write no transcript lines. I tightened the filter and re-ran both sides; the logs kept are those of the re-run. The first B log was overwritten.
4. **First unit run of `architecture.test.ts`** (exit 1): "has only mapped module directories" failed on the empty `apps/api/src/modules/.claude/` (the write guard's). I removed it with `rmdir`, and the re-run passed 143/143 (`earlier-runs/unit-arch.log`).
5. **First `pnpm lint`** (exit 1): one `no-explicit-any` in `modular-waiver.test.ts`, fixed with the same `eslint-disable-next-line` idiom BE-F2's tests use. The re-run exited 0.
6. **One `prettier --check`** of single files exited 1 on `tasks/routes.ts` before I formatted it.
7. **One command was refused by the sandbox's safety check:** an `rm -f` with variable-expanded paths. I did not run it, and dropped it, since the recorder overwrites its files.


## 4. Operations routed (delta to my pending list)

| List | Before | After |
|---|---|---|
| `P4_PENDING_ARCH_R2` | `getInheritedRecord`, `getBenefitPlanValue` | `getBenefitPlanValue` (KBE-R3's) |

`getInheritedRecord` is exercised in `p4-exercises-be-m.ts` (`exerciseP4BeM2Operations`) through the mirrored client, so `contract.test.ts` stays green (45 tests, in the full run).

## 5. Contract, schema and codes (for the orchestrator)

- **No contract or schema need.**
  - No migration.
  - No OpenAPI edit: 649 operations.
  - Media-type pin unchanged: no JSON request body was added.
- **No new code.**
  - `gate.modular_waiver_revoked` and `gate.modular_waiver_expired` are ARCH-R2 rows 169–170, with their exact texts.
  - `work_item.system_managed` is row 172, with the new text.
  - Item 7 uses the existing `not_found`.
- **New internal surfaces** (no API effect):
  - `RegisterSpec.afterUpdate` (an optional hook in the transformations register kit);
  - `tasks` exports `followMeetingActionWorkItem` and `MEETING_ACTION_TASK`;
  - `raid` exports `insertActionItem`.

## 6. What remains, and points for the orchestrator

1. **The same outsider 403 remains in the dispensation writes.** `portfolio/dispensations.ts` create, decide and revoke use `openWrite(…, { atCommit: true })` without a request-start read gate. So a cross-organization outsider gets 403 there too (`commitTimeDenial`).
   - I did not change it: it is outside item 7's two files, and ADR-0021 W1/W7 require every other dispensation response to stay byte-identical.
   - It is an orchestrator decision.
2. **The DG2 `/actions` PATCH still does not move `raid_action_due` items of RAID-linked actions.** Only raid's action register does (BE-R1). This was not asked; the new `afterUpdate` hook would make it a one-line change.
3. **Reopening does not recreate the item.** A reopened meeting action (`done` → `in_progress`, `cancelled` → `open`) does not get a new `meeting_action_due` item. This matches the BE-R1 behaviour for linked actions, and no ADR specifies a reopen.
4. **The reassigned item's parameters.** It carries the action's current `title` and the original `meetingDate`. The ADR names the parameters, not their refresh rule.
5. **The G3 gate view's `canSubmit`** still does not reflect the Modular precondition or the waiver (BE-M2's open gap; not in this scope).
6. **FE work:**
   - the `work_item__system_managed` EN/AR keys (new text);
   - `gate__modular_waiver_revoked` and `gate__modular_waiver_expired`;
   - the dispensations page offering the Modular G3 waiver (ARCH-R2 §6 FE items).
7. **Pin reconciliation:**
   - `p4-pending-arch-r2.ts`: KBE-R3 is expected to remove `getBenefitPlanValue` in the same line. The union is `[]`.
   - No count pin changed.

8. **Nothing in the seven items of the repair scope is unfinished.** No separable second half is needed.

## 7. Merge instructions

- **No migration to run.**
- **Expect small conflicts:**
  - in `apps/api/test/support/p4-pending-arch-r2.ts` with KBE-R3 (same array line; keep neither entry once both are routed);
  - possibly in `p4-exercises-be-m.ts` and `modular.test.ts` if FE-R1 or FE-E touch them (they should not).
- **Before the merged-tree run,** remove the empty `apps/api/src/modules/.claude/` directory, if present.
