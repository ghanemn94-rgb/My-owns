# Handback T-DG5-KBE-E2 (kpi-benefits-engineer): KPI restatement decision with authority, the one restatement run, report reissue offers, the DG4 text

- **Stage:** DG5 (P5), wave W12. **Assignment:** `docs/delivery/assignments/DG5/T-DG5-KBE-E2.md` (sha256 `aa3bc153…bc6214`). **Scope:** `docs/architecture/p5-work-split.md` §G.2.
- **Invocation:** run `DG5-T-DG5-KBE-E2-kpi-benefits-engineer-20261015T210700Z-d6ac07ff`, session `d6ac07ff-6ca5-48a6-923d-234f27b939d3`.
- **Base:** branch `dg5/kbe-e2` at `278cd1d`. The changes are **uncommitted**, for the orchestrator to integrate.
- **Time:** 21:07:16Z to 23:12:51Z (`date -u`; `T-DG5-KBE-E2-evidence/end-time.txt`), about 126 minutes. The implementation and every check except the full integration suite were done by about 21:58Z. Most of the remaining time was the integration suite, which ran twice (§3.1).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` printed `PASS gate DG4 (historical)` and exited 0:
  - at the start (21:08Z, before any edit; output in this session's transcript);
  - mid-session, after the edits (`validate-dg4-mid.log`);
  - at the end (`validate-dg4-end.log`).
- **Two gate systems.** Deciding a restatement is a business approval a person makes inside the product, through the API, with `kpi_restatement.approve`. No agent, seed or job decides one. Every decision in the tests and exercises is a synthetic demo decision by a synthetic user, and it approves nothing real. Nothing here reads or writes DG0–DG7.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/kpi/restatement-decisions.ts` (new) | `decideKpiRestatement`. Under lock 730266 it checks, in order: authority (`kpi_restatement.approve` in the transformation, on the commit-time principal; otherwise 403 `kpi_restatement.no_authority`); the requester (403 `kpi_restatement.self_decision`); the status (422 `not_submitted`); and the note (422 `note_required`). It records `authority_permission` and `authority_role_code`, writes one `kpi_restatement.decide` audit event and completes the decision tasks. On approval it writes the outbox event `kpi_restatement.approved` v1. |
| `apps/api/src/modules/kpi/restatement-offers.ts` (new) | `listKpiRestatementReissueOffers` (`transformation.read`): the offers, each with its snapshot's current state. Read-only. |
| `apps/api/src/modules/kpi/restatements.ts` | Only the registration lines for the two routes above, and the header note. |
| `apps/worker/src/handlers/kpi.ts` | Adds the restatement run (`applyRestatement`, `runRestatement`, `offerReissues`, `reportIssuers`) and routes `kpi_restatement.approved` to it inside `recalculate`. `loadKpi` takes an optional version id. `toEvaluationRow` evaluates with the version the slot was evaluated with (in a DG4 run that is the active one, so nothing changes there). The run-writing tail of `runCalculation` moves unchanged into `persistRun`, which both runs use. |
| `apps/worker/src/queues/kpi.ts` | `kpi_restatement.approved` → `kpi.recalculate` (the same consumer). |
| `packages/shared/src/schemas/kpi-restatement.ts` | Adds the zod mirrors `kpiRestatementDecision`, `kpiRestatementReissueOffer`, `kpiRestatementReissueOfferList`, and the outbox payload `kpiRestatementApprovedV1`. |
| `packages/shared/src/schemas/events.ts` | One import and one registry line: `"kpi_restatement.approved": { 1: kpiRestatementApprovedV1 }` (additive; see §5). |
| `packages/shared/src/schemas/change-control.ts` | The ADR-0047 §3 text line for `change_request.retrospective_not_supported`. |
| `apps/api/test/integration/workflows/change-requests.test.ts` | The one DG4 assertion that pins that text, updated to the new text. Code and status are unchanged. |
| `apps/api/test/integration/kpi-restatements/decisions.test.ts` (new) | The literal §G.2 tests (§2 below). |
| `apps/api/test/integration/kpi-restatements/decision-fixtures.ts` (new) | `decide`, `reissueOffers`, `runRestatementEvents` (the worker consumer, driven as the relay would deliver the event) and `issuedKpiRegister`. |
| `apps/api/test/integration/contract/p5-exercises-kbe-e2.ts` (new) | Contract exercises of both operations through the validating client. |
| `apps/api/test/integration/contract/contract.test.ts` | Wires in the exercises (import, mirrors, one `it`). Media-type pin `[380, 379, 1]` → `[381, 380, 1]` (§5). |
| `apps/api/test/support/p5-pending-kbe-e2.ts` | Emptied (§4). |
| `apps/api/src/modules/kpi/kpi.test.ts` | Module route pin: `KPI_P5_KBE_E2_OPERATIONS` (2), and `kpi_restatement.approve` added to the write permissions. |

No migration, no new dependency, no OpenAPI change.

## 2. Behaviour delivered (REQ-S07-016)

**Acceptance text (binding):** "A07: a prospective target change leaves last quarter's RAG unchanged; a restatement of Q1 without authority is rejected; the Q1 report issued earlier is unchanged and a reissue creates version 2."

KBE-E delivered the first clause (the prospective rule, test (a)). This task delivers the second and third.

- **"a restatement of Q1 without authority is rejected"** (test (b), `decisions.test.ts`). On a submitted Q1 restatement:
  - TL, KDS and AUD each get 403 `kpi_restatement.no_authority`, with the exact ADR-0047 §8 text.
  - The requester gets 403 `kpi_restatement.self_decision`, even though they hold `kpi_restatement.approve` (FIN+KDS; D-142 Q10).
  - Afterwards the row is deep-equal to before, the `kpi_restatement.*` audit trail is still `create, submit`, the outbox is empty, and the decision tasks are unchanged and open. Each refusal writes only its `authorization.denied` audit, which every 403 carries (ADR-0004); the test asserts all four.
- **"the Q1 report issued earlier is unchanged and a reissue creates version 2"** (test (c)):
  - **Setup:** a KPI register report is issued while Q1 shows 90; it records `kpi_version` v1. Target v2 (120) is approved through a DG4 change request decided by BO. The restatement of Q1 with v2 is requested by KDS, approved by BO, and then the event is delivered three times.
  - **Runs and stamps:**
    - `["done","duplicate","duplicate"]`: exactly one `restatement_approved` run (slot 1, key `kpi_restatement:<id>`).
    - A redelivery under another idempotency key answers `already_run` with the same run id.
    - The restatement is `applied` with `calculationRunId`, version 4, and one `kpi_restatement.apply` audit (actor service, on behalf of the decider).
  - **Restated values:**
    - Q1's latest evaluation is the run's, with v2 and target 120.
    - Every run evaluation equals the retained reconciliation's `after` (status, value, RAG, target).
    - The pre-restatement evaluation stays readable through `before.evaluationId`.
  - **The issued report:**
    - The snapshot GET is deep-equal to before (content, hash, approval state), and so is its versions list.
    - The offers are the register (no period) and a synthetic Q1 executive-dashboard snapshot. A synthetic Q2 one gets none (the period-overlap rule).
    - `report_reissue_offer` work items exist per series and holder of `report.issue`, with dedupe `report_reissue_offer:<restatementId>:<seriesId>:<userId>`, each once.
  - **The reissue:** `reissueReportSnapshot` plus issue gives `issueVersion` 2 in the same series. v1 is `superseded` with unchanged content, hash and approval state, and its offer then lists `snapshotStatus: superseded`.
- **ADR-0047 §3 automation "Restatement approved -> recalc selected periods and offer report reissue":**
  - The worker evaluates exactly the retained reconciliation's slots of the selected periods, with the restated version, plus the formula KPIs that read the restated KPI, transitively, with their own active versions.
  - The run is written through the same `persistRun` as DG4 runs: evaluations, findings, `kpi.deviation_evaluated` and `kpi.values_recalculated`.
- **Binding note (D-156 g; test "the restatement run of a formula KPI"):** a restated formula KPI binds each input to its source's latest stored evaluation of the same scope id, period and input basis, the reconciliation preview's rule. The applied values equal the retained `after` values (period and cumulative, 42 = 21 + 21). The lineage `inputs.sources.a` names the bound evaluation's version, `valueSource: entered` and the value.
  - **Limit of this test:** in this fixture, binding to the stored evaluation and recomputing from accepted values give the same 42. The test therefore proves the equality and the lineage, but does not tell the two binding rules apart. A fixture that does would need a source whose latest evaluation differs from a recompute, which takes a second source version through a change request; it was not built in the time.
- **Rejection:** without a note it is 422 `kpi_restatement.note_required` and nothing is written. With a note, FIN rejects: `authorityRoleCode: FIN`, no outbox event, the decision tasks are `done`, and a second decision gives 422 `kpi_restatement.not_submitted`.
- **Mutation rules** (the last test, and the exercises): AUD 403. `If-Match` missing gives 428, stale gives 409. Unknown id gives 404; an unknown body member gives 400. Commit-time re-authorization: a BO whose grant is revoked while the request waits gets 403, and the row stays `submitted`/2 with no outbox event. There is exactly one `kpi_restatement.decide` event, with prior/new version 2→3 and status `submitted`→`approved`.

## 3. Checks (real exit codes; logs in `T-DG5-KBE-E2-evidence/`)

| Command | Exit | Result / counts | Log |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG4` (start, mid, end) | 0, 0, 0 | `PASS gate DG4 (historical)` | start in the transcript; `validate-dg4-mid.log`, `validate-dg4-end.log` |
| `pnpm -r typecheck` | 0 | all packages | `typecheck.log` |
| `pnpm -r build` | 0 | all packages | `build.log` |
| `pnpm lint` | 0 | `eslint . --max-warnings=0` | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | all files | `prettier.log` |
| `pnpm openapi:lint` | 0 | 846 operations | `openapi-lint.log` |
| `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE`) | 0 | 2011 / 1429 / 259 + 2 skipped | `unit-locale-unset.log` |
| `pnpm test`, `LANG=C.UTF-8 LC_ALL=C.UTF-8` | 0 | 2011 / 1429 / 259 + 2 skipped | `unit-c-utf8.log` |
| targeted: `with-pg.sh npx vitest run --project integration apps/api/test/integration/kpi-restatements` | 0 | 13/13 (4 new + KBE-E's 9) | `targeted-kpi-restatements.log` |
| targeted: same, `apps/api/test/integration/contract` | 0 | 79/79 | `targeted-contract.log` |
| `QA_PG_PORT=24710 MTH_PORT_POOL=24711-24749 tests/qa/support/with-pg.sh pnpm test:integration` (run 2) | 0 | 253 files, **2440/2440** | `integration.log` |
| same command, ports 24700/24701-24749 (run 1) | **1** | worker-process crash, no failing test (§3.1) | `integration-run1-worker-crash.log` |

**Disclosed failure:** the first targeted run of `kpi-restatements` exited 1, with 3/13 failing. All three were in my new test file, not the product:
- The audit helper also counted the `authorization.denied` events, so it now filters on `kpi_restatement.*`.
- The synthetic period snapshots lacked the audit events that the `p2` guard requires at COMMIT, so the fixture now writes them.

The second run passed 13/13; that log is the one kept.

### 3.1 Full integration

- **Run 1** (started 22:10:35Z) **exited 1** without any failing test:
  - 78 files had passed when a Vitest pool child died: `Error: Channel closed` / `ERR_IPC_CHANNEL_CLOSED` (tinypool), followed by `ELIFECYCLE`.
  - At that moment the machine had 16 GB of RAM, 12.5 GB in use, no swap, and a load average of about 23, with four W12 tasks running at once.
  - The likely cause is that a test worker was killed under memory pressure (the F-DG4-148 class of environment failure). I did not prove it, because `dmesg` gave no output in the sandbox.
- **Run 2** of the identical command (started 22:31:23Z, at load 10–15) exited 0: 253 files, **2440/2440** tests.
- **Count change:** D-156 recorded 2435. This task adds 5 integration tests (the 4 in `decisions.test.ts` and the contract `it` for KBE-E2), so 2440 is expected. No other pinned count changed apart from the media-type pin (§5).

## 4. Operations routed (delta to `p5-pending-kbe-e2.ts`)

| Operation | Before | After | Route | Exercised in |
|---|---|---|---|---|
| `decideKpiRestatement` | pending | routed | `POST /api/v1/transformations/{t}/kpi-restatements/{r}/decision` | `p5-exercises-kbe-e2.ts`: 400 ×2, 428, 404, 403 (outsider: commit-time), 409, 403 `no_authority` (AUD, TL), 403 `self_decision`, 422 `note_required`, 200 reject, 422 `not_submitted`, 200 approve |
| `listKpiRestatementReissueOffers` | pending | routed | `GET …/kpi-restatements/{r}/reissue-offers` | 200 (empty before the run; one `registers` offer after the worker run), 400, 404 ×2 |

`P5_PENDING_KBE_E2` is now `[]`. Declared but not reachable: 401 and 429 (their own suites); 403 on the read (every caller who can see a transformation holds `transformation.read`).

## 5. For the orchestrator: contract, schema, pins, shared files

1. **Media-type pin:** +1 JSON body (`decideKpiRestatement`), so `[380, 379, 1]` → `[381, 380, 1]` in this branch. Reconcile by summing with W12's other deltas. The rate-limit floor was not touched.
2. **Shared file, additive:** `packages/shared/src/schemas/events.ts` gets one import and one registry entry. W12 tasks that register events will conflict here by union only.
3. **`contract.test.ts`:** one import, one mirrors line and one `it` (BE-A created no KBE-E2 exercise file, so this task adds the wiring). The conflicts are additive.
4. **The en/ar `problems.json` key** (append-only merge, §5.3; I did not edit web files). The proposed new values:
   - en `change_request__retrospective_not_supported`: "A change request takes effect from now on; restate closed periods through a KPI restatement."
   - ar (provisional translation): "يسري طلب التغيير من الآن فصاعدًا؛ لإعادة بيان الفترات المغلقة استخدم إعادة بيان مؤشر الأداء."
5. **No new problem code.** Every refusal is an ADR-0047 §8 code and text, reusing KBE-E's `restatementRefusals`. No `db-errors.ts` line was needed: the API refuses before any 0085 constraint can fire. `kpi_restatement_sod` and `kpi_restatement_decision_complete` stay backstops.
6. **Interpretations made, for review:**
   - (a) The decision route's write gate is `transformation.read`, and the approval right is checked on the record afterwards. This is what lets a reader without the right get the slice's own 403 `no_authority` rather than generic `forbidden`. The route's declared permission (`config.access`) is `kpi_restatement.approve`.
   - (b) `authority_role_code` is the first role in code order among the decider's grants that give the right on the transformation.
   - (c) The decision completes (`done`) every open decision task of the restatement: ADR-0047 §3 item 1, "is completed". `closeWorkItemsOfSubject` has no per-assignee filter.
   - (d) The restatement run evaluates exactly the retained reconciliation's slots. Freshness uses the business date of the day the run executes, so a stale boundary crossed between submission and application could make an applied status differ from the retained `after`. The other inputs are the same as the preview's.
   - (e) No `failed` run is recorded for a restatement on the last attempt. That run would be its one run (unique trigger key), and the restatement could then never be applied. The dead-lettered job is retried from the failure queue instead.
   - (f) The run emits `kpi.deviation_evaluated` per period evaluation, as DG4 runs do. Its consumers (RAID corrective, adoption) may therefore react to a restated closed period. If that is not wanted, a reviewer may ask for the events to be suppressed for restatement runs.
   - (g) The `kpi_restatement.updated_by` stamp of the apply step is the decider, because the column is NOT NULL and holds a user. The audit actor is the service, on behalf of the decider.
   - (h) The reissue work item's subject is the series' latest offered snapshot, its link is `/transformations/{t}/reports/{snapshotId}`, and its message key is `kpi_restatement.reissue_offer`.

## 6. User-facing texts made untrue by this work

| Text | Where | Action |
|---|---|---|
| `change_request.retrospective_not_supported` (API detail) | `packages/shared/src/schemas/change-control.ts` | **Changed** to the ADR-0047 §3 text; the DG4 test pin is updated. |
| `change_request__retrospective_not_supported` en/ar | `apps/web/src/i18n/{en,ar}/problems.json:514` | **For the orchestrator** (§5 item 4; append-only merge). |
| `changeRequestsP4.form.effectiveFromHint` en/ar ("A past date is a retrospective restatement, which is not supported.") | `apps/web/src/i18n/{en,ar}/changeRequestsP4.json:95` | **For FE-F** (web owner). Suggested en: "Leave empty to apply from now on. A change request never applies to a past period; closed periods are restated through a KPI restatement." |
| Message key `kpi_restatement.reissue_offer` (new work items) and KBE-E's `kpi_restatement.to_decide` | web My Work message translations | **For FE-F** (untranslated keys, the D-156 j precedent). |

`kpi_actual__period_not_open` ("… a closed period is corrected through a restatement.") and `kpiP4.closedNote` were true from KBE-E onwards and stay unchanged.

## 7. What remains

- REQ-S07-016 completes with FE-F (`pages/kpi-restatement/**`: decision UI, offers list, the "Restated" label) and QA-B (A07).
- The D-156 g binding test does not tell the stored-evaluation binding apart from a recompute (§2).
- Not done: a worker-level unit test of `offerReissues`' overlap SQL in isolation. It is covered by the integration test (Q1 offered, Q2 not, the period-less register offered).

## 8. Merge instructions

There are no migrations. Expect additive conflicts in `contract.test.ts` (the pin and the wiring), `events.ts`, and possibly `apps/worker/src/handlers/kpi.ts` if another W12 task edits it (none is assigned to). Rebuild `@mth/shared` before running the worker or API, because the event registry is in `dist`.
