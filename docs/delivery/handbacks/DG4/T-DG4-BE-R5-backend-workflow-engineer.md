# Handback T-DG4-BE-R5 (backend-workflow-engineer): DG4 round-1 finding repairs F-DG4-103 and F-DG4-100 (`completeWorkItem`)

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-BE-R5-backend-workflow-engineer-20261011T005850Z-5484f9e4","session_id":"5484f9e4-831b-422e-9750-b896da8550fb"}`.
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-BE-R5.md`. I verified its sha256 as `017cddde9febc195b1579e69000a3a47b716541f405cd6a0d05eae40022edd5e`.
- **Base:** worktree `/home/user/wt/dg4-be-r5`, branch `dg4/be-r5`, at `HEAD f5579e7` (the integrated head with the round-1 findings imported and D-117).
- **Changes:** left **uncommitted** for the orchestrator.
- **Time:** started 00:59:02 UTC; the end time is in `T-DG4-BE-R5-evidence/end-time.txt`.
- **Synthetic data:** every gate decision in the new tests is a synthetic in-product business decision by a test person, and it approves nothing real. No engineering agent granted any business, Finance or IT approval. Nothing reads or writes DG0–DG7, and product G6 never implies DG7.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG3` gave `PASS gate DG3 (historical)`, exit 0, both at the start and at the end (`validate-dg3-historical-start.log`, `validate-dg3-historical-end.log`).

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/workflows/gates.ts` | **F-DG4-103.** `decideGate` decides every check after the request-start read gate on reloaded grants (`refreshPrincipal`, then `commitTimeDenial`). `submitGate` and `configureGateApprover` (the finding's "updateGate", `PATCH …/gates/{gateCode}`) go through a new local `writeAtCommit`. It runs `openWrite` on the request-start grants unchanged, then re-runs the same read and write gates on reloaded grants. |
| `apps/api/src/modules/tasks/routes.ts` | **F-DG4-100.** `completeWorkItem`'s 403 `work_item.not_assignee` carries `.withDenial(notAssigneeDenial(item))`, so the failed-mutation hook writes exactly one `authorization.denied`. The response body is unchanged. |
| `apps/api/test/integration/workflows/gate-commit-time.test.ts` (new) | 9 integration tests for F-DG4-103: a grant is revoked, or the session ended, between request start and commit, plus controls (§2.1). |
| `apps/api/test/integration/tasks/work-items.test.ts` | +3 integration tests for F-DG4-100 (a new `describe` at the end, two imports). Existing tests are unchanged. |
| `apps/api/test/integration/workflows/be-r5-ab-transcript.test.ts` (new) | 6 integration tests: the A/B byte-stability transcript (`MTH_BE_R5_TRANSCRIPT`) for G1/G5/G6 configure, submit and decide, and `completeWorkItem`. Unset, it is an ordinary regression test. |
| `docs/delivery/handbacks/DG4/T-DG4-BE-R5-backend-workflow-engineer.md`, `…/T-DG4-BE-R5-evidence/**` | This handback and its logs. |

No migration, no new endpoint, no contract or schema change, and no shared-test-support change. Every file listed is inside BE-R5's scope (D-117: F-103, and F-100 for `completeWorkItem`). I edited no file of slice B (`benefits/**`, KBE-R5's).

## 2. Behaviour delivered, per finding and requirement row

### 2.1 F-DG4-103 (REQ-PB-015): G1–G6 gate operations re-check authorization at commit time

**REQ-PB-015 acceptance (quoted):** "A08: submission with missing mandatory evidence is rejected; approval by a non-approver returns 403; approval of a stale submission version is rejected." This is unchanged and still covered by the existing suites, which pass (§3). The finding's **expected** text is "every P4 mutation re-checks server-side authorization at commit time (the DG3 lesson 4 pattern: refreshPrincipal on reloaded grants, then commitTimeDenial). The P4 G5/G6 business approvals … go through decideGate."

**The design, and why `openWrite(…, { atCommit: true })` was not used.** With `atCommit`, the only read gate runs on the reloaded grants. `commitTimeDenial` then turns an outsider's 404 into a 403. That would change the DG2/DG3 404 a cross-organization caller gets on `submitGate` and `configureGateApprover`, and break the byte identity the assignment requires. So each operation now decides twice, exactly as `decideApproval` does (approvals.ts):

1. **At request start, unchanged.**
   - `openWrite` for submit and configure.
   - `requireTransformationRead` plus the D-094 `technicalAdminRefusal` for decide.
   - Every existing refusal keeps its status, body and audit row.
2. **At commit time.**
   - `refreshPrincipal(tx, request)` re-resolves the session and reloads the grants inside the transaction. A session that ended meanwhile gives 401.
   - The same gates then run again on the reloaded grants: read, plus `requireRecordWrite` with `gate.submit` or `gate.configure`.
   - For decide, `isApprover` and the separation-of-duties checks now use the reloaded principal.
   - `commitTimeDenial` turns a read right revoked meanwhile into 403 `forbidden` ("Your access to this record changed while the request was in progress."), with its denial. An approver role revoked while the read remains fails check 2 with the existing 403 `gate.not_approver`, with its denial.
   - In both cases exactly one `authorization.denied` is written.

**The revocation test** (`gate-commit-time.test.ts`) uses the BE18A technique, `calendar/session-lock.ts` `afterIdentity`. The request is held in the identity hook after its grants were loaded and before the handler runs. The grant is revoked or the session ended, and the request then runs.

| Test | Before the change (`repro-before.log`) | After (`repro-after.log`, full run) |
|---|---|---|
| decide, control (nothing revoked) | 201 | 201 |
| decide, every grant of the Sponsor revoked | **201, decision recorded** | 403 `forbidden`, no `gate_decision`/`decision`, one `authorization.denied` (`… requires transformation.read`) |
| decide, only the SP role revoked (the read remains through TL) | **201** | 403 `gate.not_approver`, no decision, one `authorization.denied` (`… requires gate.decide`) |
| decide, session ended | **201** | 401, nothing written, no audit row |
| submit G1, control | 201 | 201 |
| submit G1, the TL's grants revoked | **201, submission written** | 403 `forbidden`, no submission, gate row unchanged, one `authorization.denied` |
| configure G5, control | 200 | 200 |
| configure G5, the TO's grants revoked | **200, approver changed** | 403 `forbidden`, approver unchanged, one `authorization.denied` |
| configure G5, only TO revoked (the read remains through AUD) | **200** | 403 `forbidden`, one `authorization.denied` (`… requires gate.configure`) |

In the before run, 8 tests failed, each for exactly the defect: `expected [ 201, … ] to deeply equal [ 403, 'forbidden', … ]`, `expected 201 to be 401`, `expected [ 200, … ] …`. The 4 controls passed.

### 2.2 F-DG4-100, `completeWorkItem` part (REQ-S10-003; ADR-0004 §3)

**REQ-S10-003 acceptance (quoted):** "A12: an ADM-only user calling a gate or Finance approval endpoint gets 403." That is unchanged; `completeWorkItem` is neither a gate nor a Finance approval endpoint. The finding's **expected** text is the ADR-0004 §3 coverage rule: "every failed authorization of a mutation writes exactly one audit event". The finding's note asks to "decide whether completeWorkItem's record-level 403 is a failed authorization to audit". D-117 decided it is ("BE-R5: … F-100 for `completeWorkItem`").

**Delivered:**

- The 403 `work_item.not_assignee` (same status, code, title and detail) now carries a denial.
- The denial names the item's scope the way `denialOf` names a target: `recordType` `transformation` with the item's transformation id, or `organization` with its organization id for an item outside any transformation.
- `permission` is `work_item.complete`, so the audit reason reads `POST /api/v1/work-items/:workItemId/complete requires work_item.complete`.
- A scope-level record rather than the work item's own id keeps the existing assertion `auditOf(workItemId) = [create, complete]` in `work-items.test.ts` unchanged.

**Tests** (`work-items.test.ts`, describe "F-DG4-100"):

- AUD (same organization, not the assignee): 403, exactly one `authorization.denied` naming the organization, and the item is unchanged (open, v1). **Before: failed**, `expected [] to deeply equal [ [ 'authorization.denied', … ] ]`.
- Item of a transformation: the one denial names the transformation. **Before: failed** the same way.
- Negatives: an outsider gets 404 and **no** audit row (existence is not disclosed, and a missing record is not an authorization event). The assignee's 200 writes only `work_item.complete`. This passed before and after.

## 3. Checks (final tree; logs in `T-DG4-BE-R5-evidence/`)

Environment: Node 24.21.0, offline, ports 26150–26199. The disk had 16–17 GB free before every full run (`df -h .`).

| Command | Exit | Result | Log |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG3` (start) | 0 | `PASS gate DG3 (historical)` | `validate-dg3-historical-start.log` |
| `pnpm -r typecheck` | 0 | | `typecheck.log` |
| `pnpm -r build` | 0 | | `build.log` |
| `pnpm lint` | 0 | | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `format.log` |
| `pnpm openapi:lint` | 0 | | `openapi-lint.log` |
| `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE`) | 0 | invocation 1: 145 files, **2771/2771**; invocation 2: 3 files, **259 passed, 2 skipped** | `unit-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | invocation 1: **2771/2771**; invocation 2: **259 passed, 2 skipped** | `unit-c-utf8.log` |
| `QA_PG_PORT=26150 MTH_PORT_POOL=26151-26199 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | 204 files, **1940/1940** (1123 s; includes the +18 of this task) | `integration.log` |
| reproduction before the change (2 files) | 1 | 8 failed, 19 passed (27); every failure is the finding's defect | `repro-before.log` |
| reproduction after the change (2 files) | 0 | 27/27 | `repro-after.log` |
| A/B transcripts (§4) | 0 / 0 | each side: 7 passed, 4 skipped (11) | `ab/ab-run-A.log`, `ab/ab-run-B.log` |
| `node tools/gates/validate.mjs --historical --stage DG3` (end) | 0 | `PASS gate DG3 (historical)` | `validate-dg3-historical-end.log` |

**Disclosed non-zero exits and stops:**

1. **The first locale-unset `pnpm test` exited 1** (`earlier-runs/unit-locale-unset-run1.log`).
   - The failure: 1 of 2771, in `apps/web/src/auth/session-bound.test.tsx`, "F-DG2-530/580 … (en) > Y1c: the same create under one identity still lands on the created record". The assertion `expected … to have a length of 2 but got 3` means one extra `/me` request after the POST. It ran at a load average of about 16–18, with other agents running.
   - `&&` stopped the script, so the second Vitest invocation did not run in that attempt.
   - This task changed no web file and no API response the web reads (§4).
   - Re-run alone (`earlier-runs/session-bound-alone-locale-unset.log`): 34/34, exit 0. The full locale-unset re-run (`unit-locale-unset.log`) passes both invocations, exit 0.
   - It is a timing-sensitive web test under load. I did not change it or raise any timeout.
2. **The first prettier check exited 123** (`earlier-runs/format-first.log`): my three new or changed test files were not formatted. `prettier --write` on those three files fixed it; the final check exits 0.
   - The A/B runs in §4 ran before that formatting. Formatting changes only whitespace in test code, and the final integration run executes the formatted files.
3. **The first full integration run was stopped by my agent tool's own 600 s background limit**, not by a test (`earlier-runs/integration-run1-stopped-by-tool-timeout.log`).
   - It produced no result. No test had failed up to that point: 415 passed lines, no `×`/`FAIL`.
   - I re-ran it with a longer tool limit. No Vitest timeout was raised.

**Pinned counts:** the media-type pin in `contract.test.ts` stays `[323, 322, 1]`, because no request body or operation was added. My additions to the integration count are +18: 9 commit-time, 3 work-item and 6 transcript tests.

## 4. Byte stability (the response-transcript method)

**Procedure** (`ab/ab-commands.txt`):

- Run **A** is this tree.
- Run **B** is the same tree with `gates.ts` and `tasks/routes.ts` replaced by `git show HEAD:…`.
- Afterwards my files were restored and verified by sha256 (`ab/restore-check.txt`: both `OK`).
- Both runs used the same tests: `be-r5-ab-transcript.test.ts` and BE-M2's `modular-precondition.test.ts` "End-to-End G1-G4: unaffected".

| Transcript | Lines | `cmp` A vs B | sha256 |
|---|---|---|---|
| `be-r5` (new): `configureGateApprover` 428/409/AUD 403/ADM-only 404/outsider 404/G6-BO 422/200/pending 422; `submitGate` G5 out-of-sequence 422, G1 201 with accepted exceptions, G1 view, G5 AUD 403/outsider 404/428/409/criteria 422, G6 out-of-sequence 422, gate list; `decideGate` G5 outsider 404, ADM-only 403, AUD 403, BO 403 `gate.not_approver`, submitter 403 `gate.submitter_cannot_decide`, 409 superseded, 422 scale scope, SP 201, then 409, G5 view and submission; G6 `changes_requested` 201, then approved 201, G6 view; `completeWorkItem` AUD 403 `work_item.not_assignee`, outsider 404, 428, 409, 200, 422 closed | 38 | **BYTE-IDENTICAL** | `8930d0d14dfe4d6c840f955c5713fdcb7b13023d97fead3aae6b9bcb6be14273` |
| `e2e-gates`: BE-M2's 21 End-to-End G1–G4 responses (`MTH_BE_M2_TRANSCRIPT`) | 21 | **BYTE-IDENTICAL** | `6e253bc701bcc88927781818cb6289f9286a9808b9f6527fa68a9b71013b1456` |

**The D-112 hash.** On both sides, today's End-to-End transcript differs from the one D-112 recorded (`be4f2daa…`) in one value only:

- The fixture's exception `expiresOn` is `inDays(60)` = `Date.now()` + 60 days (`modular-precondition.test.ts:36`).
- BE-M2 recorded on 2026-10-10 (`2026-12-09`); this run was on 2026-10-11 (`2026-12-10`).
- It is the only date in the transcript, with 45 occurrences.
- Substituting `2026-12-09` back gives exactly **`be4f2daad11ae8acfecab410afd9c96db3a29982be2493e8914e2d21c0d28768`** for both A and B, the D-112 hash (`ab/compare.txt`).

**Members changed:** none. No response member differs between A and B in either transcript.

The only observable changes are:

- **(a)** the new responses in a race: 403 `forbidden` with the commit-time detail, or 401, where a revoked caller previously got 201/200;
- **(b)** one new `authorization.denied` audit row per refused `completeWorkItem`, which is a row, not a response byte.

**`be-r5` normalization:** its wrapper masks the fixture transformation's random code (`"TX" + 6 hex`, from `createTransformationRow`), so that `cmp` applies. The first A/B attempt, before the mask, differed only in that code, on 2 lines (`ab/first-attempt/`). The shared normalizer `response-transcript.ts` is unchanged, so no earlier transcript hash moves.

## 5. Pending operations (delta)

- **None routed, none added.** Both findings change existing, already-routed operations (`decideGate`, `submitGate`, `configureGateApprover` and `completeWorkItem`).
- No `p4-pending-*.ts` list belongs to this task, none changed, and `contract.test.ts` is green in the integration run.

## 6. For the orchestrator: contract and schema needs

- **Contract:** none needed. All four operations already document 401 and 403 in `docs/api/openapi.yaml`.
  - The commit-time 403 uses the existing `forbidden` problem with the same commit-time detail the other P4 operations use (`access/request.ts`).
  - The 401 is the existing `unauthenticated`.
- **Note for the architect (optional text only):**
  - ADR-0025 §4 could state that the 403 `work_item.not_assignee` is audited as `authorization.denied`, with `permission` `work_item.complete` and the item's transformation (or organization) as the record.
  - `work_item.complete` is a denial label, not a catalogue permission. No role grants it, because only the assignee completes.
- **F-DG4-100, slice B part:** not mine. It belongs to KBE-R5 (D-117). The ADM-only denial-audit test for `decideFinanceValidation` and `decideBenefitBaseline` is theirs.

## 7. What remains

- **Nothing in my scope.** F-DG4-103 and the `completeWorkItem` part of F-DG4-100 are implemented, tested before and after, and proven byte-stable.
- **Closure is the reviewers' call.** An author never closes their own finding; the round-2 code-security reviewer re-runs the reproductions.

## 8. Merge instructions

- **Migrations:** none. **Ordering:** none.
- **Expected conflicts:**
  - `work-items.test.ts` only if another task appends to its end.
  - `gates.ts` only if another repair edits the imports or `decideGate`'s opening lines. D-117 assigns no other task to `gates.ts`.
