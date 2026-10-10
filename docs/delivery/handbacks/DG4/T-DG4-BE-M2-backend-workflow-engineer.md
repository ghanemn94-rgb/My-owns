# Handback T-DG4-BE-M2 (backend-workflow-engineer): Modular entry, with inherited records, gate labels, missing links and the Modular G3 precondition

- **Stage:** DG4 (P4), p4-work-split §J+K JK.2. **Invocation:** `DG4-T-DG4-BE-M2-backend-workflow-engineer-20261009T232726Z-dd80ca9a`, session `dd80ca9a-07eb-4eb6-9211-d8faed9199de`.
- **Base:** branch `dg4/be-m2` at `8a641e1` (the integrated HEAD). Assignment sha256 `80914be9…c5a7b7` was verified.
- **Time:** started `Fri Oct 9 23:27:38 UTC 2026` and ended `Sat Oct 10 00:47 UTC 2026` (`date -u`), about 80 minutes.
- **State:** the changes are **uncommitted** for the orchestrator. No migration was added and none is needed.
- **Synthetic data:** every approval in the tests is synthetic demo data and approves nothing real. That covers the inherited G2 approval accepted by the synthetic Sponsor, the fixture gate exceptions and waivers, and the End-to-End gate decisions. Nothing reads or writes DG0–DG7. Product G6 never implies DG7.

## 0. Read first: wiring, decisions and deviations

1. **Production wiring (D-107).** No route depends on `server.ts` wiring:
   - The four routes register through the existing `registerModularRoutes` line in `reporting/index.ts`.
   - The precondition in `workflows/gates.ts` reads `transformations/index.ts` exports directly; there is no port.
   - Every BE-M2 integration test uses `startApi()`, which builds the real server through the harness with nothing wired by hand. The contract test exercises the four operations on that same server.
2. **The waiver path deviates from the assignment's instruction. An orchestrator decision is needed.** The assignment says "BE-K2 is merged: gate exceptions exist; use them for the waiver path". I could not do this without a schema change, for two reasons:
   - **A `gate_exception` cannot name the Modular links.** It must cover a *mandatory criterion of that gate*:
     - the trigger `gate_exception_mandatory_criterion` and the FK to `gate_criterion_definition` enforce this;
     - G3's five criteria are TOM, gap matrix, capability gaps, future journeys and design decisions;
     - none of them is "baseline" or "outcome links".
   - Accepting *any* accepted G3 exception as a waiver of the links would silently waive a control nobody waived (M0095 "never … bypass controls"). So I did not do that.
   - **What I implemented** is the D-106 (e) / ADR-0038 §7.4 text: "an accepted, unexpired G3 waiver". That is a `gate_dispensation` of kind `waiver`, for G3, with no initiative, `status = 'accepted'`, and `expires_on` on or after today's business date in the transformation's timezone. The business date comes from BE-K2's clock (`exceptionBusinessDate`), so that much of BE-K2 *is* reused.
   - **Open gap: this waiver cannot be created through the API for a Modular transformation.** The DG3 route refuses it with `dispensation.waiver_requires_end_to_end`. A dispensation waiver also has no scope or compensating action (ADR-0035 Context 5). The rule works (it is proven with a fixture row), but a user cannot reach it today.
   - **Options for the orchestrator:**
     - (a) A narrow reopen of `portfolio/dispensations.ts`, so that a G3 waiver is allowed for a Modular transformation **only** for the Modular-links precondition.
     - (b) A repair migration (0061–0069) that adds a dedicated G3 criterion for the Modular links, which `gate_exception` can then cover. This adds a criterion to every G3, including End-to-End G3 criteria lists. That would break the byte-identity requirement unless the evaluator hides it for End-to-End.
     - (c) Record the "or an authorized waiver exists" clause as reachable only through supplying the links in DG4.
3. **The precondition runs *after* the criteria check, not before it as ADR-0038 §7.4 says.**
   - The reason is the DG2-approved test `apps/api/test/integration/dg2-repairs.test.ts:461` ("Modular entry stays valid…"). It asserts that a Modular-at-Design G3 submission with no links answers `gate_criteria_incomplete`. Running the precondition first would change that DG2 response.
   - After the criteria check, every existing refusal keeps its order and body, including that one.
   - A G3 submission without the links is still always refused: by the criteria error while criteria are missing, else by `gate.modular_links_missing`.
4. **Scope is G3 only (the D-106 (e) text).** ADR §7.4's wider wording ("the gate that closes its entry phase or any later gate") is not implemented. A Modular transformation entering at Mobilize or later never reaches G3. Its G4 keeps the DG2 refusals (tested: Modular G4 → `gate.out_of_sequence`).
5. **New codes and texts (S-11; not in the ARCH-R1 table or ADR-0038 §12):**
   - `inherited_record.record_not_found` (422, at `/evidenceId` or `/baselineId`): "The evidence item or baseline does not exist in this transformation or is archived."
   - The `errors[]` messages of `gate.modular_links_missing` (codes = the §7.3 item codes):
     - `/baseline` `baseline_missing`: "No active baseline with a value is recorded."
     - `/outcomes` `outcome_link_missing`: "No active outcome has an active KPI."
   - The Arabic label text "موروث - مُسجَّل، ولم يُمنح في المنصة" is **provisional** and needs Mobily review.
6. **Media-type pin (`contract.test.ts`): +2, from `[304, 303, 1]` to `[306, 305, 1]`.** The two are `createInheritedRecord` and `withdrawInheritedRecord`, both JSON bodies. This was the only edit to `contract.test.ts`: the pin and its comment line.

## 1. Files changed

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/missing-links.ts` (new) | Mirrors `MissingLinks`, `MissingLinkItem`, `MissingLinksGate`, `InheritedRecord`, `InheritedRecordCreate`, `InheritedRecordPage`. Holds the **pure** §7.3 rule (`deriveMissingLinks`, `blockingMissingLinks`), the §7.2 labels (`gateLabelOf`, `inheritedApprovalAnnotation`), the refusal texts and the label texts |
| `packages/shared/src/schemas/missing-links.test.ts` (new) | 10 unit tests of the rule, the labels and the create body |
| `packages/shared/src/schemas/index.ts` | One export line (after BE-M's) |
| `apps/api/src/modules/transformations/missing-links-facts.ts` (new) | Read-only facts (`loadMissingLinkFacts`, `loadModularEntryFacts`), shared by the report and the precondition |
| `apps/api/src/modules/transformations/index.ts` | One export line |
| `apps/api/src/modules/reporting/modular.ts` | The stub is replaced: `getMissingLinks`, `listInheritedRecords` (including the read-only `prior_approval` entries), `createInheritedRecord`, `withdrawInheritedRecord` |
| `apps/api/src/modules/platform/db-errors.ts` | The BE-M2 block `mapP4ModularEntryError` (the `0055` `inherited_record` guards), chained right after BE-M's |
| `apps/api/src/modules/workflows/gates.ts` | Three import names, one call line in `submitGate`, and the function `assertModularLinks` (45 added lines, nothing removed) |
| `apps/api/test/support/p4-pending-be-m2.ts` | Emptied (4 → 0) |
| `apps/api/test/integration/contract/p4-exercises-be-m.ts` | Appended after BE-M: 4 mirrors, the call `exerciseP4BeM2Operations(ctx)` at the end of BE-M's exercise, the Modular fixture (`seedModularWorld` and helpers), and the exercises |
| `apps/api/test/integration/contract/contract.test.ts` | The media-type pin only (+2; §0.6) |
| `apps/api/test/integration/reporting/modular.test.ts` (new) | 11 integration tests |
| `apps/api/test/integration/workflows/modular-precondition.test.ts` (new) | 5 integration tests, including the End-to-End transcript recorder |
| `docs/delivery/handbacks/DG4/T-DG4-BE-M2-evidence/**` | Logs and the A/B transcripts |

## 2. Behaviour delivered, per requirement row

### REQ-PB-005

Acceptance: "A03: a transformation entering at Design with no baseline and no outcome links shows both as missing and G3 submission is rejected by the API until they are supplied or an authorized waiver exists".

- **"Shows both as missing" (`GET /api/v1/transformations/{id}/missing-links`):**
  - On a Modular entry at Design, `items` lists `baseline_missing` and `outcome_link_missing` with severity `blocking`. Each `href` is the collection where the item is supplied.
  - The per-record warnings of §7.3 follow: `outcome_kpi_missing`, `initiative_*_missing`, `benefit_missing`, `benefit_outcome_link_missing` and `inherited_approval_unverified`.
  - A baseline without a value does not count.
  - After a baseline with a value and an active outcome KPI are added, both blocking items disappear.
  - The test is `modular.test.ts` "G2 is labelled inherited…".
- **"G3 submission is rejected … until they are supplied":**
  - With G3's own criteria met, the response is 422 `gate.modular_links_missing` with the exact ADR §12 detail, and `errors[]` = `/baseline` and `/outcomes`. Nothing is written: same gate row, 0 submissions.
  - With only the baseline added, `errors[]` = `/outcomes`. With both added, the response is **201** and the gate is `submitted`.
  - The test is `modular-precondition.test.ts` "422 … 201 once both are supplied".
- **"… or an authorized waiver exists":**
  - An accepted G3 waiver expiring in 30 days gives **201**. An accepted waiver that expired 2 days ago gives 422, and so does a pending one.
  - The missing-link report still lists both items after a waived submission: a waiver supplies nothing.
  - This clause is **only partly delivered**, because the waiver cannot be created through the API for a Modular transformation (§0.2).
- **"never marks earlier gates approved without recorded evidence":** see the labels under REQ-S03-005.
- **Order kept:** without G3's criteria, a Modular G3 still answers the DG2 `gate_criteria_incomplete` (§0.3).

### REQ-S03-005

Acceptance: "A03: entering at Design with an inherited G2 approval document shows G2 as 'inherited' (not Approved); a missing baseline and outcome link are flagged and G3 submission is rejected until supplied or waived".

- **G2 is 'inherited' (not Approved):**
  - With an accepted inherited-approval dispensation for G2 on verified evidence, `gates[]` shows G2 `{status: "draft", label: "inherited"}`. No gate carries `approved`.
  - A pending dispensation is labelled `inherited_pending_verification` and adds an `inherited_approval_unverified` warning.
  - `approved` appears only for `gate_instance.status = 'approved'` (unit-tested).
  - The annotation is asserted equal to the DG3 `GET …/gates` annotation for all six gates.
- **No gate decision and no gate change:** `gate_instance` rows (status and version) and the `gate_decision` count are snapshotted before and after; they are equal and the count is 0.
- **Labelled inherited records (POST/GET `…/inherited-records`):**
  - Inherited evidence and baselines are listed with provenance: `sourceDescription`, `originalOwner`, `originalDate`, `recordedBy`.
  - The prior approval is listed as a read-only `prior_approval` entry: `gateDispensationId`, `gateCode`, `approvingBody`, approved date, evidence and status.
  - Every entry carries `label: "inherited"`. Its render text `INHERITED_LABEL_TEXT.en` = "Inherited - recorded, not granted in platform" is asserted verbatim.
  - The API returns the label key; FE-G translates it at render time (S-6).
  - The canonical rows are referenced, never copied, and an inherited baseline stays `unvalidated`.
- **Withdrawal:** `active → withdrawn` (terminal) with a reason. Provenance stays unchanged. A withdrawn record is hidden unless `includeRemoved=true`, and the item can be recorded again as a new row.
- **Refusals:**
  - End-to-End → 422 `inherited_record.not_modular`.
  - Kind `prior_approval` → 422 `inherited_record.prior_approval_use_dispensation` at `/kind`. No dispensation is created.
  - Duplicate → 409 `inherited_record.duplicate`.
  - Record outside the transformation → 422 `inherited_record.record_not_found`.
  - Already withdrawn → 422 `inherited_record.not_active`.
  - All with the exact texts.
- **"rejected until supplied or waived":** as under REQ-PB-005, with the same waiver caveat.

### S-1…S-14 as they apply

- **S-1:** free text goes through `freeText`; blank and invisible-only text is 400 (tested).
- **S-2:** the shared parser is used.
- **S-3:** `config.consumes = application/json` on both POSTs. The undeclared-media-type sweep of the contract test covers them.
- **S-4:**
  - Commit-time re-authorisation is tested: a grant revoked mid-request gives 403 and nothing is written.
  - Validation 400s are tested.
  - `If-Match` on the withdrawal: 428 / 409 with `currentVersion`. Creates are version 1, `ETag "1"`.
  - One audit event per mutation, in the same transaction: `inherited_record.create` and `inherited_record.withdraw`. Refused writes leave none.
  - No remote I/O.
  - AUD, BO and SP get 403 on create; AUD and BO get 403 on withdraw. Another organization's TO gets 404 on reads and 403 on writes (the existing atCommit `commitTimeDenial` pattern).
- **JK.10 item 2:** the report is computed in a read-only, repeatable-read transaction and stored nowhere.
- **JK.10 item 4:** `reporting` imports `portfolio` and `transformations` only. `workflows` imports `transformations` and `@mth/shared` only. The architecture boundary tests pass.
- **JK.10 item 7:** no slice K path writes `gate_decision` or `gate_instance.status`.

### End-to-End G1–G4 byte identity (D-106 (e): "prove it")

This is an A/B recorded-response comparison.

- **The scenario.** One End-to-End world goes through the full chain with **no baseline and no outcome link**. The chain records:
  - G1 428 / 409 / AUD 403 / `gate_criteria_incomplete`;
  - G2, G3 and G4 `gate.out_of_sequence`;
  - for each of G1→G2→G3 in turn: criteria covered by accepted BE-K2 exceptions → submit 201 → gate view → synthetic Sponsor decision 201 → `gate.already_approved`;
  - G4 `gate_criteria_incomplete`;
  - the gate list.
  - That is 21 responses: status, ETag, Location and body (minus `requestId`).
- **The normalization.** Ids, instants, 64-hex hashes and the fixture's id-derived outcome name are replaced by first-appearance placeholders. Every other byte is kept.
- **The runs.**
  - Run A uses my tree.
  - Run B uses the same tree with `gates.ts` replaced by `git show HEAD:apps/api/src/modules/workflows/gates.ts`.
  - My file was restored and verified by sha256 (`gates.ts: OK`).
- **Result: `cmp` reports **BYTE-IDENTICAL**.** Both transcripts have sha256 `be4f2daad11ae8acfecab410afd9c96db3a29982be2493e8914e2d21c0d28768` (21 lines each).
- **Evidence:** `e2e-transcript-with-precondition.jsonl`, `e2e-transcript-base-gates.jsonl`, `e2e-run-with-precondition.log` and `e2e-run-base-gates.log` (each 1 passed | 4 skipped, exit 0).
- **The existing tests also pass unchanged:** the DG2/DG3 gate tests in the full integration run, including `dg2-repairs.test.ts`.

## 3. Checks (final tree; logs in `T-DG4-BE-M2-evidence/`)

| Command | Exit | Result |
|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG3` (start and end) | 0 / 0 | `PASS gate DG3 (historical)` (`validate-dg3-historical-{start,end}.txt`) |
| `pnpm -r typecheck` | 0 | `typecheck.log` |
| `pnpm -r build` | 0 | `build.log` |
| `pnpm lint` | 0 | `lint.log` (`--max-warnings=0`) |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | `prettier.log` |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 647 operations` |
| `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | 0 | unit-node + unit-web: **123 files, 2352 passed**; unit-formula-nocodegen: **3 files, 259 passed, 2 skipped** (`unit-locale-unset.log`) |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | the same counts: 2352; 259 + 2 skipped (`unit-c-utf8.log`) |
| `QA_PG_PORT=25100 MTH_PORT_POOL=25101-25149 tests/qa/support/with-pg.sh pnpm test:integration` | 0 | **163 files, 1603 passed** (`integration.log`); no port retry logged |

**Count deltas against D-109:**
- Unit is 2342 → 2352: +10, the new `missing-links.test.ts`.
- Integration is 1587 → 1603: +16, from 11 tests in `modular.test.ts` and 5 in `modular-precondition.test.ts`.
- The contract test's operation count is unchanged at 647; the media-type pin is +2 (§0.6).

Disk was 21 GB free before each full run (`df -h .`). The empty `.claude/.cc-writes` directories under `apps/api` and `packages/shared` were removed before the tests.

**Non-zero exits and failures during the work (all fixed; disclosed per the evidence rule):**
1. First `modular.test.ts` run: 7 of 11 failed, all from fixture or expectation errors:
   - the baseline `scope` must be an enum value;
   - an End-to-End create needs `mode: "end_to_end"`;
   - an outsider's write is 403 under the atCommit pattern, not 404.
   - Log: `earlier-runs/modular1.log`. The re-run passed 11/11 (`earlier-runs/modular2.log`).
2. First `modular-precondition.test.ts` run: the End-to-End test failed because a G1 approval needs the B0032 `agreements` (`earlier-runs/pre1.log`). It was fixed in the test.
3. First A/B comparison: the transcripts differed only in the fixture outcome name "Synthetic outcome <6 hex of a random id>". The normalizer was extended to cover it, and both sides were re-recorded. The first B run is `earlier-runs/pre3.log`. Its transcript was not kept, because it was in `$TMPDIR`.
4. First full unit run (locale unset): 3 failed, the module-boundary lint ("computed property/member with a non-literal key" in `modular.ts` and `gates.ts`). Both were rewritten. That log was overwritten by the passing runs.
5. First full integration run: 1 failed, the media-type pin `[306, 305, 1]` vs `[304, 303, 1]`. It was fixed per §0.6. That log was overwritten by the passing run.
6. One `prettier --check` exited 123 on my unformatted new files. They were formatted and the check now exits 0.

No test was skipped, retried or marked flaky to pass. The two skips in the formula suite are pre-existing.

## 4. Operations routed (delta to `p4-pending-be-m2.ts`)

| Operation | Route | Before | After |
|---|---|---|---|
| `getMissingLinks` | `GET /api/v1/transformations/{transformationId}/missing-links` | pending | routed and exercised |
| `listInheritedRecords` | `GET …/inherited-records` | pending | routed and exercised |
| `createInheritedRecord` | `POST …/inherited-records` | pending | routed and exercised |
| `withdrawInheritedRecord` | `POST …/inherited-records/{inheritedRecordId}/withdraw` | pending | routed and exercised |

`P4_PENDING_BE_M2` goes from 4 to 0. The four mirrors are in `P4_MIRRORS_BE_M`. The exercises (`exerciseP4BeM2Operations`) run inside the existing "P4 BE-M operations" contract case, so `contract.test.ts` needs no new case.

## 5. Contract and schema needs (for the orchestrator)

1. **The waiver path (§0.2): a decision is needed.**
2. **There is no single-record GET for inherited records.** `createInheritedRecord` must send `Location` (it is declared). It points to `…/inherited-records/{id}`, which has no read operation in `openapi.yaml`. The contract test only checks that the header is present. If a resolvable `Location` is required (the ARCH-R1 `getAdoptionMetricLink` precedent), add a `getInheritedRecord` operation.
3. **The new code and texts of §0.5:** add them to the consolidated code table and the FE i18n keys.
4. **ADR-0038 §7.4 wording:** "runs … before criteria evaluation" does not match the as-built order, which is after it and deliberately so (§0.3). The ADR also names `packages/shared/src/traceability/missing-links.ts`, while the work split, which I followed, names `schemas/missing-links.ts`. Both are ADR text corrections.
5. **No migration is needed.**

## 6. What remains

- **Waiver reachability** (§0.2): the "or an authorized waiver exists" clause of REQ-PB-005 and REQ-S03-005 is implemented in the rule but cannot be reached through the API for a Modular transformation until the orchestrator decides.
- **The G3 gate view's `canSubmit`** (`GET …/gates/G3`) does not reflect the precondition. My ownership covers the `submitGate` lines only. A Modular G3 with complete criteria but missing links shows `canSubmit: true`, and its submission is then refused with the 422. FE-G should read `getMissingLinks`, or a later task should extend `canSubmit` (Modular-only, so End-to-End stays byte-identical).
- **A waived Modular G3 submission does not record the waiver in its snapshot**, as D-089 Q2 does for exceptions. This was left out to keep G1–G3 snapshots byte-stable. It can be added as a Modular-only snapshot member if wanted.
- **FE-G:** the Modular-entry views, and the EN/AR keys for the label, the codes and the item codes.
- **QA-C:** A03 can use `seedModularWorld` and the helpers exported from `p4-exercises-be-m.ts`.

## 7. Merge instructions

- There are no migrations.
- **Merge after BE-M**, which is already merged. My `db-errors.ts` block and its chain line sit directly after BE-M's. My `schemas/index.ts` line is at the end of the file.
- **BE-M3 appends after me:** its exercises and fixture go after my section in `p4-exercises-be-m.ts`, and its `db-errors` block after `mapP4ModularEntryError`.
- **Expect a conflict on the media-type pin** in `contract.test.ts` if another W13 task also adds JSON bodies. Sum the deltas: mine is +2.
- **`gates.ts`:** the edits are three named imports, one call line after the `gate_criteria_incomplete` throw in `submitGate`, and one function appended at the end of the file. BE-R2 may touch other parts of the file; textual overlap is unlikely.
