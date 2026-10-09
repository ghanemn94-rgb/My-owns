# Handback T-DG4-BE-K2 (backend-workflow-engineer): gate reviews and Under Review, gate exceptions, the expiry scan

- **Stage:** DG4 (P4). **Task:** T-DG4-BE-K2, p4-work-split §H H.2. **Branch:** `dg4/be-k2`. **Base:** `85cae06be8db43b6e322c842efc4e5541f383d43`.
- **Invocation:** `DG4-T-DG4-BE-K2-backend-workflow-engineer-20261009T183930Z-b5391f7d` (session `b5391f7d-8a10-4881-b823-7a6e92de0c7e`).
- **Time:** started 2026-10-09T18:39:43Z, ended 19:42:03Z (`date -u`).
- **Changes:** left **uncommitted** for the orchestrator.
- **Two gate systems:** G1–G6 are business approvals inside the product. Nothing here reads or writes DG0–DG7 or `docs/delivery/` records. Every exception decision and gate decision in the tests is a synthetic demo decision by a test person, and no job approves anything.

## 0. Items for the orchestrator (read first)

1. **Production wiring: none needed.**
   - The routes are registered through `workflows/index.ts` (`registerGateExceptionRoutes` already existed; I added the one `registerGateReviewRoutes` line).
   - The worker handler is registered in `GATES_HANDLERS`.
   - `server.ts` is not touched.
   - Every BE-K2 test builds the real server through `startApi()` → `buildServer()` (`apps/api/test/support/harness.ts:80`) with nothing wired by hand. So the routes are proven in the production composition (D-107 lesson).
   - The only module-level state is the test-only clock hook `setGateExceptionClock`, which production never sets.
2. **Out-of-ownership edit: a contract defect fix in `docs/api/openapi.yaml`, 5 lines. Needs orchestrator acceptance.**
   - The ARCH-07 pattern `pattern: '^g[1-6]\\.[a-z_]{1,48}$'` sits in a YAML *single-quoted* string. There `\\.` is a literal backslash followed by any character, so no real criterion key (`g1.diagnostic`) can match.
   - Effect: the validating contract client rejected every `createGateException` 201 body (`data/criterionKey must match pattern`; first run of `gate-exceptions.test.ts`, 11 of 12 tests failed; log not kept, output quoted in §3).
   - **Fix:** `\\.` → `\.` on lines 17152 (parameter `CriterionKey`), 27517, 27552, 27588 and 27625 (`criterionKey` of GateCriterionRow, GateCriterionReview, GateException, GateExceptionCreate). Nothing else changed; `pnpm openapi:lint` PASS (645 operations).
   - **Not touched:** lines 17142 and 27415 (`stepKey` of BE-L2's phase steps) have the same defect. BE-L2 or the orchestrator should apply the same one-character fix.
3. **Media-type pin:** `[292, 291, 1]` → `[296, 295, 1]` (+4 JSON bodies: createGateCriterionReview, createGateException, decideGateException, revokeGateException; withdrawGateException is bodiless).
4. **No migration and no schema need.** `0051`/`0053`/`0054` were sufficient.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/workflows/gate-exceptions.ts` | Was a BE-A stub. Now: list/create/get/decide/withdraw/revoke; the exported `coveringExceptionsInTx(tx, gateInstanceId, businessDate)` (takes lock class `gateException`) and `coveringExceptions` (no lock, read path); `exceptionBusinessDate` (transformation timezone, DB clock or the injected test clock); `exceptionSnapshotOf`; the ADR-0035 §11 refusals; `gate_exception_to_decide` work items; one-hop delegation |
| `apps/api/src/modules/workflows/gate-reviews.ts` (new) | `listGateSubmissionCriteria` (nine fields plus the recorded exception), `listGateCriterionReviews`, `createGateCriterionReview` (submitted → under_review on the first review, with audit) |
| `apps/api/src/modules/workflows/index.ts` | One import and one registration line for `registerGateReviewRoutes` |
| `apps/api/src/modules/workflows/gates.ts` | Three groups of lines, listed below |
| `apps/api/src/modules/platform/db-errors.ts` | `mapP4GateReviewExceptionError` (the BE-K2 block, after BE-K's and before BE-L's) and its one call line after BE-K's. Each mapper is still defined and called once. |
| `packages/shared/src/schemas/gates-p4.ts` | Appended: review and exception zod mirrors (create, decision, revoke, row, page, list) |
| `apps/worker/src/handlers/gates.ts` | Appended: `runGateExceptionExpiryScan` (the `gate.exception_expiry_scan` handler) and its `GATES_HANDLERS` entry |
| `apps/worker/src/queues/gates.ts` | The `gate.exception_expiry_scan` queue. No event → queue entry, since it is schedule-started (`0054`). |
| `apps/api/test/support/p4-pending-be-k2.ts` | 9 → 0 operations |
| `apps/api/test/integration/contract/p4-exercises-be-k.ts` | Appended: 9 mirrors in `P4_MIRRORS_BE_K`; shared fixtures (`todayOf`, `plusDays`, `missingMandatory`, `exceptionBody`, `requestException`, `acceptException`, `coverGate`, `submitThroughApi`, `requesterApprover`); `exerciseP4BeK2Operations`, called at the end of BE-K's exercise function (no new seam and no new `contract.test.ts` call) |
| `apps/api/test/integration/contract/contract.test.ts` | Media-type pin +4, with its comment line |
| `apps/api/test/integration/workflows/gate-exceptions.test.ts` (new) | 12 tests (REQ-S04-012/013) |
| `apps/api/test/integration/workflows/gate-reviews.test.ts` (new) | 6 tests (REQ-S04-009/010) |
| `apps/worker/test/integration/gates.test.ts` | Appended: 2 tests (expiry scan; queue and handler registration) |
| `docs/api/openapi.yaml` | 5-line pattern fix (§0 item 2) |
| `docs/delivery/handbacks/DG4/T-DG4-BE-K2-*` | This handback and the logs |

The three groups of `gates.ts` lines (written after BE-K's):

- **`submitGate`:** under the gateException lock, the covering exceptions on today's business date. A covered mandatory criterion row is frozen `incomplete` with `gate_exception_id`, and its snapshot entry gains `exception: {id, reason, scope, compensatingAction, compensatingOwnerUserId, expiresOn, decidedBy, decidedAt}`. The 422 lists only the uncovered criteria, in the exact DG2/BE-K form.
- **`decideGate`:** step 5a, the 422 `gate.exception_expired` on approval only.
- **`gateView`:** `canSubmit` counts a covering exception. Without one, the result is the DG2 result, and nothing extra is read when no mandatory criterion is missing.

Untracked files that are not mine (sandbox stubs present at start): `.bash_profile`, `.bashrc`, `.gitconfig`, `.gitmodules`, `.idea`, `.mcp.json`, `.profile`, `.ripgreprc`, `.vscode`, `.zprofile`, `.zshrc`, `CLAUDE.local.md`.

## 2. Behaviour delivered, per requirement row

### REQ-S04-009

> A08: a gate decision without rationale is rejected by the API; each criterion row persists all nine fields

- `GET …/gates/{gateCode}/submissions/{no}/criteria` returns one row per frozen criterion. The nine fields are:
  - criterion: `criterionLabelEn/Ar`;
  - required evidence: `requiredEvidenceEn/Ar`;
  - completeness;
  - `reviewerUserId`, `finding`, `openCondition`, `risk {note, raidEntryId}`, `decision` (the recommendation) and `rationale`, all from the latest review.
- Unreviewed rows show those six as null ("not reviewed"), never "meets". Each row also has `reviewCount` and the recorded `exception`.
- `POST …/criteria/{key}/reviews` (gate.review; SP, BO, FIN, TO) persists them. The test asserts 9 of 9 non-null and that the stored row equals the read row.
- A decision without rationale gives 400 (DG2 schema; asserted from Under Review).
- Refusals:
  - 403 `gate.reviewer_is_submitter`;
  - 422 `gate.review_not_open`;
  - 422 `gate.review_condition_required` at `/openCondition`;
  - a risk link outside the transformation gives 422 `validation.reference` at `/raidEntryId`;
  - a criterion outside the submission gives 404.

### REQ-S04-010

> A08: all seven statuses exist; a direct Draft -> Approved transition is rejected; each transition writes an audit event

- The first review of a `submitted` gate sets `under_review` (version + 1) in the review transaction, with audit `gate_instance.review_open`. Later reviews leave the instance unchanged.
- Draft → Approved gives DG2 409 `gate.submission_superseded` "There is no pending submission to decide.", and nothing changes.
- The test asserts that the gate-instance audit trail is exactly `gate_instance.submit`, `gate_instance.review_open`, `gate_instance.decide`, and that the status CHECK lists all seven statuses.

### REQ-S04-012

> A08: the gate page lists missing items; submission with one missing mandatory item returns 422 listing it; with a valid exception it succeeds and the snapshot records the exception

Asserted:

- the live view lists every missing item with its messages, and `canSubmit` is false;
- with no exception, the exact DG2 422 (detail with keys, one error per criterion);
- with all but one covered, 422 listing exactly the remaining one;
- with every missing item covered by an accepted, unexpired exception, 201. The snapshot's criterion entry records the exception (all 8 members asserted), the frozen row has `gate_exception_id`, and the review table shows it;
- a pending or rejected exception does not cover.

### REQ-S04-013

> A08: a waiver without expiry or compensating action is rejected; after expiry the covered evidence item is again reported missing

- **Missing fields:** dropping any of `expiresOn`, `compensatingAction`, `reason`, `scope` or `compensatingOwnerUserId` gives 400 `validation` at that pointer, and nothing is written.
- **Create refusals:** 422 `gate_exception.expiry_in_past`, 422 `gate_exception.criterion_not_mandatory`, 409 `gate_exception.already_pending`.
- **Decision authority:**
  - requester → 403 `gate_exception.requester_cannot_decide` (the requester holds TL+SP in the test);
  - non-approver (BO) → 403 `gate_exception.not_approver`;
  - ADM-only → 403;
  - AUD → 403 on create, decide, withdraw and revoke;
  - one hop of delegation (record type `gate_exception`, via `POST /delegations`) decides for the SP, with `decidedOnBehalfOf` recorded;
  - a delegate acting for a non-approver → 403.
- **Expiry (clock injected with `setGateExceptionClock`):**
  - after `expires_on` the exception reads `covering: false` while its status stays `accepted`;
  - the live view reports the criterion `incomplete` again with `canSubmit` false;
  - the submission gives 422 listing it;
  - approving a submission whose recorded exception has expired gives 422 `gate.exception_expired` "The exception for {label} expired on {date}; it no longer covers the missing evidence.", with no decision written, while `changes_requested` still gives 201.
- **"The owner is notified":** `gate.exception_expiry_scan` (worker, `asOf` injected). Exactly once, it creates:
  - one `gate_exception_expired` task for the requester, with its inbox notice;
  - one `gates.notice.gate_exception_expired` notice to the approver;
  - `expiry_notified_at` set, with audit `gate_exception.expiry_notified`.

  A second scan creates nothing. Neither a replaced (revoked) exception nor a lasting one is notified, and the gate is unchanged.
- **Revoke:** a missing, null, blank or empty reason gives 400 with error code `gate_exception.revoke_reason_required` at `/reason`; a second revoke gives 422 `gate_exception.not_accepted`; after revoke the criterion is missing again.
- **Withdraw:** a non-requester gets 403 (generic `forbidden`, see §5); a second withdraw gives 422 `gate_exception.not_pending`; the approver's task is cancelled.
- **Concurrency and audit:** If-Match 428/409 on decision, withdraw, revoke and review. One audit event per mutation, asserted per record.

**Status of the rows:** I consider all four rows implemented and tested. Verifying them is the reviewers' job.

## 3. Checks actually run (worktree `/home/user/wt/dg4-be-k2`, Node 24.21.0, offline; harness ports 24600–24649)

| Command | Exit | Result (log under `docs/delivery/handbacks/DG4/T-DG4-BE-K2-evidence/`) |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG3` (start) | 0 | `PASS gate DG3 (historical)` (`validate-dg3-historical-start.log`) |
| `pnpm -r typecheck` | 0 | `typecheck.log` |
| `pnpm -r build` | 0 | `build.log` |
| `pnpm lint` | 0 | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" (`prettier.log`) |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 645 operations` (`openapi-lint.log`) |
| `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | 2293 passed (120 files) + 259 passed / 2 skipped (`unit-locale-unset.log`) |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | 2293 passed + 259 passed / 2 skipped (`unit-c-utf8.log`) |
| `QA_PG_PORT=24600 MTH_PORT_POOL=24601-24649 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **1502/1502**, 144 files (`integration.log`); = 1482 (D-107) + 12 exceptions + 6 reviews + 2 worker. No pinned count changed except the media-type pin. |
| `node tools/gates/validate.mjs --historical --stage DG3` (end) | 0 | `PASS gate DG3 (historical)` (`validate-dg3-historical.log`) |

Disk was checked before each full run (`df -h .`: 22 GB, then 20 GB free).

Non-zero exits along the way, all disclosed and fixed before the final runs:

1. **First targeted run of `gate-exceptions.test.ts` (exit 1, 11 of 12 failed):** `contract: createGateException 201 body violates the schema: data/criterionKey must match pattern "^g[1-6]\\.[a-z_]{1,48}$"`. This is the contract defect of §0 item 2. After the fix: 12/12 (`targeted-exc2.log`).
2. **First targeted run of `gate-reviews.test.ts` (exit 1, 1 of 6 failed):** my expected audit list omitted the instance's own `gate_instance.create` event. I fixed the test filter (the code was not wrong); then 6/6 (`targeted-rev2.log`).
3. **First full unit runs, both locales (exit 1; 2 failed / 2291 passed each):**
   - (a) `architecture.test.ts`: an empty `.claude` stub directory left by the write guard in `apps/api/src/modules`. I removed the empty `.claude/.cc-writes` stubs as the assignment says.
   - (b) `advisory-locks.test.ts`: my comments spelled the literal class number of the gateException lock. I reworded them.
   - Re-runs: both exit 0 with the counts above. The first-run logs were overwritten by the re-runs; the failure output is quoted here.

Targeted runs before the full suite: `targeted-exc2.log` (12/12), `targeted-rev2.log` (6/6), `targeted-wc1.log` (worker `gates.test.ts` + `contract.test.ts`, 53/53). No flaky test was observed, and no timeouts occurred.

## 4. Operations routed (delta to `p4-pending-be-k2.ts`)

Removed all 9, so the list is empty. Each is exercised through the validating client in `exerciseP4BeK2Operations`:

- `listGateSubmissionCriteria`
- `listGateCriterionReviews`
- `createGateCriterionReview`
- `listGateExceptions`
- `createGateException`
- `getGateException`
- `decideGateException`
- `withdrawGateException`
- `revokeGateException`

## 5. Contract and schema needs, and interpretations for review

1. **openapi.yaml `criterionKey` pattern fix** (§0 item 2), and the same defect in BE-L2's `stepKey` lines 17142 and 27415, which I did not touch.
2. **i18n keys for FE-A/FE-F** (S-6):
   - message keys: `gates.task.gate_exception_to_decide`, `gates.task.gate_exception_expired`, `gates.notice.gate_exception_expired`;
   - audit actions: `gate_exception.create|decide|withdraw|revoke|expiry_notified`, `gate_criterion_review.create`, `gate_instance.review_open`;
   - the ADR-0035 §11 codes are used verbatim.
3. **No new refusal codes.** Withdrawal by someone other than the requester returns the generic 403 `forbidden` ("Only the requester can withdraw their exception."), because ADR-0035 §11 lists no code for it. The architect may want a dedicated code.
4. **A revoked exception recorded in a still-pending submission** does not block that submission's approval. ADR-0035 §4 defines the decision-time refusal for **expiry** only, and revoke says "missing again from that moment". I did not invent a `gate.exception_revoked` code. The architect should decide whether revoke must also block the approval of an already-frozen submission.
5. **No approver found for a new exception:** no `gate_exception_to_decide` item is created and no routing notice is sent. The worker's `routing.role_unmapped` notice pattern is not reproduced in the API path, because domain modules may create items only through `createWorkItemOnce`. This is visible only by the absence of a task. It is a small gap.
6. **Delegation record type:** a delegate decides an exception for the approver only through a delegation whose `record_types` includes `gate_exception` (or is null). It uses BE-B's `actsFor`, which requires the delegator to hold `gate_exception.decide`, and the delegate must hold `gate_exception.decide` itself (D-094 (4) precedent).
7. **Interpretations:**
   - An exception may be requested for a mandatory criterion whether or not it is currently complete (ADR silent).
   - Accepting an exception is not refused on the gate's status.
   - The review If-Match is the gate instance's ETag, as the contract says, so only the first review bumps it.
   - The review 201 sends `Location` (contract) and no `ETag` (not declared).

## 6. What remains

- Nothing in §H H.2's scope is left unimplemented.
- Open points for others: §5 items 1 (BE-L2's `stepKey` patterns), 3, 4 and 5 (architect or orchestrator decisions), and FE translations (§5 item 2).

## 7. Merge instructions

- No migrations.
- Expected textual merges:
  - `p4-exercises-be-k.ts` (BE-K2 only appends);
  - `db-errors.ts`: BE-L's block already follows mine. My function sits between BE-K's and BE-L's, and my call line between theirs, so a union keeps one definition and one call per mapper;
  - `contract.test.ts` pin (+4 on top of whatever W11 tasks add);
  - `openapi.yaml` (5 lines).
- `gates.ts`, the worker `gates.ts` and `queues/gates.ts` are edited only by me in W11.
