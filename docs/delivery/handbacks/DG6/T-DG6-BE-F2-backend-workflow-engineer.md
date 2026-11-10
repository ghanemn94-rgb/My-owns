# Handback T-DG6-BE-F2 (backend-workflow-engineer): finalized evidence, `includesRestrictedRecords` in the contract, the export refusal code, the register-kit list text

- **Stage:** P6 "Integration and system hardening", gate DG6 (BUILDING). Scope: D-199 (BE-F §5, BE-B2 §6, ARCH-04 §5 item 7).
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-F2.md`, sha256 `c55d31e1828e6e069d497df70f9da191e0113b6c3db23be60f9608971a17039f` (verified before starting).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-F2-backend-workflow-engineer-20261027T032131Z-0f3b8411","session_id":"0f3b8411-0935-43ae-9609-8d452207ff27"}`.
- **Working tree:** worktree `/home/user/wt/dg6-be-f2`, branch `dg6/be-f2`, base `HEAD` `af13bd6168e3a77485d95133f0a9ada7f0783735`. The changes are **uncommitted**, as the assignment asks.
- **Time:** `date -u` at start `Tue Oct 27 03:21:43 UTC 2026`; at end `Tue Oct 27 05:09:45 UTC 2026`.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, **exit 0**. It ran at the start, before any change, and again at the end (§4).
- **Two gate systems.** Nothing here reads or writes DG0–DG7 records. The only product-gate actions are synthetic G1 decisions by a synthetic Sponsor on test data in a disposable database: one approval (BE-F's world) and one rejection (a new test). They approve nothing real. Product G6 never implies DG7.

## 1. Files changed

| File | Purpose |
|---|---|
| `apps/api/src/modules/evidence/routes.ts` | The finalized rule: `evidenceFinalized` (409 `evidence.finalized`) and `supportsApprovedGateDecision`. `removeEvidenceLink` refuses the link that an approved submission's snapshot cites. `archiveEvidence` now has its own route here (`registerEvidenceArchiveRoute`), because the register kit's `archive.refuse` hook is synchronous and has no transaction. The kit registration keeps create and update (`ops.archive: false`). |
| `apps/api/src/modules/reporting/exports/jobs.ts` (BE-B2's lines only) | `includesRestrictedRecordsRefusal`: 403 `export.includes_restricted_records` replaces `problems.forbidden()` in `requireUnrestrictedSelection`. That refusal runs at the request, at commit time and at download. |
| `docs/api/openapi.yaml` | `includesRestrictedRecords` (optional boolean, BE-B2's description) on `BenefitTotals`, `TransformationDashboard`, `WorkstreamDashboard`, `FinanceDashboard` and `DashboardDrilldown`. The 200 description of the 9 register-kit list operations is corrected (§2.4). |
| `packages/shared/src/schemas/benefit-values.ts` | `benefitTotals.includesRestrictedRecords: z.boolean().optional()`. |
| `packages/shared/src/schemas/dashboards.ts` | The same field on `transformationDashboard`, `workstreamDashboard`, `financeDashboard` and `dashboardDrilldown`. |
| `apps/web/src/i18n/en/problems.json`, `apps/web/src/i18n/ar/problems.json` | The two new codes only: `evidence__finalized` and `export__includes_restricted_records`. The Arabic is provisional (§6). |
| `apps/api/test/integration/hardening/integrity-sweep.test.ts` | The two `it.fails` pins become normal tests asserting 409 `evidence.finalized`, with nothing written. 4 new tests cover the boundaries (§3). The stale DELETE pin now lists `deleteSavedView` (§3). |
| `apps/api/test/integration/access/sensitive-reads.test.ts` (BE-B2's test) | The `contract: false` calls (totals, transformation dashboard, finance dashboard, drill-down) go back to the validating client. The two export refusals assert the new code, type and text. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-F2-backend-workflow-engineer.md`, `docs/delivery/handbacks/DG6/T-DG6-BE-F2-evidence/*.log` | This handback and the logs of every check, each with its command, its UTC times and `exit=`. |

There is **no migration**: the highest file on the branch is still `0108`. There is also no new dependency, no new operation, and no `p6-pending-*` or `p6-exercises-*` change.

## 2. Behaviour delivered

### 2.1 REQ-S16-023: finalized evidence (ADR-0052 §9.1; D-199 BE-F §5)

Acceptance (quoted): **"A08;A07: deleting an approved gate decision or its evidence returns 409; an illegal status transition returns 422 invalid-transition (ADR-0007); a duplicate unique key returns 409"**.

This task closes the "its evidence" clause. BE-F found two defects (proposed F-DG6-BE-F-1 and -2): both destructive operations on evidence answered 200.

- **The rule.** Evidence is *finalized* when the evidence snapshot (`snapshot.evidence[]`) of a gate submission in the same transformation cites it, and that submission holds a `gate_decision` with outcome `approved`.
  - `archiveEvidence` on such an item → **409**, `type urn:mth:problem:invalid-transition`, `code evidence.finalized`, `detail` "This evidence supports an approved gate decision and cannot be archived or unlinked.". Nothing is written: same status and version, and no audit row for the request.
  - `removeEvidenceLink` on the link the approved snapshot cites (the same `evidenceId` and `record` `<recordType>:<recordId>`) → the same 409, with nothing written.
  - A link of the same item to a record that the approved snapshot does not cite stays removable. So does evidence cited only by a submission that is pending, rejected, has changes requested or was deferred.
- **Order of checks** (both operations): 404 (out of scope or missing) → 403 (write rules) → 400 (reason) → 428/409 `version_conflict` (If-Match) → 422 (already archived or removed) → 409 `evidence.finalized`. An unauthorized caller therefore never learns that the item is finalized.
- **The `archiveEvidence` route.** It is a line-for-line equivalent of the register kit's archive: same access config (`evidence.create`), same `ARCHIVE` rules with the item's creator and owner, the `reasonRequest` body, `lockEvidence` (If-Match, `FOR UPDATE`, version, archived), the same update columns, the audit event `evidence.archive` (prior and new version, reason, `status` diff), and the `Evidence` body with its ETag. The rule needs the write transaction, and the kit's `archive.refuse(row)` is synchronous, so I did not edit the kit (not my file). The existing evidence suites pass unchanged (`evidence.test.ts` 6/6, `evidence-register.test.ts` 9/9).
- **Concurrency.** The citing submissions are read `FOR SHARE`, then the decision is read in a separate statement:
  - A decision in progress (`gate_decision_guard` locks its submission `FOR UPDATE`) and an archive or unlink are serialized, and the later one sees the earlier commit.
  - An archive that commits while the submission is still pending is allowed, as before. The decide path does not re-check evidence status; that is outside this task (§7 item 3).
  - The gate paths never lock evidence rows, so there is no lock-order deadlock.
- **Database guard: none added.** ADR-0052 §9 does not call for one. Its integrity model is the API refusal (§9.1) plus "no DELETE privilege for `mth_app`" (catalogue test; ADR-0003 `ON DELETE RESTRICT`). A trigger would also need a `db-errors.ts` mapping, which is not my file. Proposal for the orchestrator: if a reviewer wants defence in depth, add a `BEFORE UPDATE OF status` trigger on `evidence` and `evidence_link` (constraint `evidence_finalized`) and map it to the same 409.
- **The rest of the acceptance** (approved gate decision not deletable; 422 `invalid_transition`; duplicate 409) was already asserted by BE-F's sweep and is unchanged here.

### 2.2 Contract additions (D-196 item 4, D-199 BE-B2 §6)

`includesRestrictedRecords: { type: boolean, description: "Present when the response includes a sensitive benefit or business case: true when the reader is not admitted to at least one of them (ADR-0051 §2; label access.includesRestrictedRecords)" }` is added and is **not** required. It is on the five named schemas (operations `getBenefitTotals`, `getPortfolioBenefitTotals`, `getTransformationDashboard`, `getWorkstreamDashboard`, `getFinanceDashboard`, `getDashboardDrilldown`), and in their zod mirrors as `z.boolean().optional()` with the same description. BE-B2's calls are validated against the contract again: the 15 `sensitive-reads.test.ts` tests pass with every response validated, including those carrying `true` and `false`.

### 2.3 The export refusal code (D-199)

When the snapshot includes a record the requester may not see, the export is refused with **403**, `type urn:mth:problem:forbidden`, `code export.includes_restricted_records`, `detail` "This report includes records you cannot see, so it cannot be exported for you.". This applies at the request (live selection or by snapshot id), at commit time and at download. It replaces the generic `forbidden`. Other `forbidden` refusals in `jobs.ts` (no `export.create`) are unchanged. Tested in `sensitive-reads.test.ts` (both refusal tests).

### 2.4 Contract text fix (D-199, ARCH-04 §5 item 7)

The 200 response description of the 9 register-kit list operations is now `"Page, in `id` ascending order (the register kit's order; `sort` absent)."`. The code orders them with `register-kit.ts` `.orderBy("id")`.

- **Changed from "Page, newest change first (`updatedAt` desc, `id` desc).":** `listStrategicGuardrails`, `listOutcomes`, `listDiagnosticItems`, `listDiagnosticFindings`, `listWorkstreamOutputs`, `listTomGaps`, `listCapabilityHeatmapEntries`, `listJourneies`.
- **Changed from "Page.", for consistency:** `listJourneyPainPoints`. It never carried the wrong text.

There is no behaviour change.

**Found, not changed (outside the named nine; for the orchestrator):** the same wrong text appears on 8 more list operations.
- `listDependencies`, `listActionItems`, `listTomWorkshops`: register-kit lists (`workflows/index.ts`), so they are `id` ascending too.
- `listEvidence`: BE-B2's metadata list, `orderBy("id")`, also ascending.
- `listKpiDefinitions`, `listBaselines`, `listOutcomeKpis`, `listValuePools`: I did not check their code order.

## 3. Tests

- **`integrity-sweep.test.ts`**, part 1. It went from 19 tests (2 of them `it.fails` pins) to **23 tests, with no `it.fails`**:
  - removing the cited link → 409 `evidence.finalized` with the D-199 text; no audit row for the request; the link's status, version and audit trail are unchanged (was the `it.fails` pin);
  - archiving the item → the same 409, with status, version and audit trail unchanged (was the `it.fails` pin);
  - **new, authorization first:** the auditor gets 403 `forbidden` on both operations and the cross-organization outsider 404 `not_found`, never 409; the item stays active;
  - **new:** a stale If-Match is still 409 `version_conflict`, because the version check precedes the rule;
  - **new, positive:** a second link of the finalized item, to a diagnostic item the snapshot does not cite, is removed (200), with exactly one audit event;
  - **new, positive:** in a second native world, evidence cited only by a **rejected** G1 submission (the snapshot holds the id) is unlinked (200) and archived (200), with exactly one `evidence.archive` audit event (prior v, new v+1).
  - **Repaired pin:** "every DELETE operation of the contract is listed" failed at the integrated `HEAD` **before my change** (`integrity-sweep-before.log`). ARCH-04's contract added `deleteSavedView`, a soft delete of one's own saved view (ADR-0057 §4; `saved_view` grants `mth_app` no DELETE). It is not a finalized record. The pin now lists both DELETEs.
- **Failing-before output** (`integrity-sweep-before.log`, base `af13bd6`, unmodified source):
  - `[integrity-sweep] removeEvidenceLink on approved-G1 evidence: 200 undefined`
  - `[integrity-sweep] archiveEvidence on approved-G1 evidence: 200 undefined`

  Both `it.fails` pins held. The file reported `Tests 1 failed | 18 passed (19)`, `exit=1`; the one failure was the stale DELETE pin above.
- **After** (`targeted-after.log`): `409 evidence.finalized` for both calls. The integrity sweep, `sensitive-reads`, `sensitive-reads-ab-transcript`, `evidence` and `evidence-register` files gave **5/5 files, 58/58 tests, exit 0**.

## 4. Checks run (real exit codes)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline; PostgreSQL disposable clusters through `tests/qa/support/with-pg.sh`; harness ports 23850–23899 only. Empty `.claude/.cc-writes` directories in source folders were checked for before the test runs; none were found. The host was shared with the other W5 runs: `/proc/loadavg` read 13–20 throughout.

| # | Command | Log | Exit | Result |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (start) | console | **0** | `PASS gate DG5 (historical)` |
| 1a | `pnpm -r typecheck` | `typecheck.log` | **0** | |
| 1b | `pnpm -r build` | `build.log` | **0** | |
| 1c | `pnpm lint` | `lint.log` | **0** | |
| 1d | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | `prettier.log` | **0** | "All matched files use Prettier code style!" (My first wrapper recorded grep's exit code instead of prettier's, so I re-ran it; the log is the re-run.) After that run I edited only a comment in `evidence/routes.ts`, and `prettier --check` on that file passed. |
| 1e | `pnpm openapi:lint` | `openapi-lint.log` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 922 operations` |
| 2a | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | `test-locale-unset.log` | **1** | unit-node **155/156 files, 2,459/2,460 tests**: the one failure is `deploy/scripts/tests/dep-audit.vitest.mjs`, "no High/Critical advisory in the committed snapshot matches a shipped component": **20 High advisories** (fastify 5.6.1, @fastify/static 8.2.0, image-size 1.2.1 …). That is the DO-A finding that **T-DG6-DO-A2** is upgrading (D-199). It depends only on `deploy/advisories/*` and the SBOM, which this task does not touch, so it fails the same at `HEAD`. unit-web **96/96 files, 1,768/1,768**. nocodegen **3/3 files, 259 passed, 2 skipped**. |
| 2b | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | — | **NOT RUN** | Time limit (§8). |
| 3 | `QA_PG_PORT=23860 MTH_PORT_POOL=23861-23899 tests/qa/support/with-pg.sh pnpm test:integration`, attempt 1 | `integration-attempt1-concurrent-crash.log` | **1** | It crashed after 21 files, none failed, with a Vitest worker `Error: Channel closed` (`ERR_IPC_CHANNEL_CLOSED`, tinypool). The cause is my own mistake: I ran it concurrently with `pnpm -r typecheck`/`build` on the loaded host (loadavg 20). Not a test failure. |
| 3' | the same command, run alone | `integration.log` | **1** | 328/330 files; 3,301 passed, 2 failed, 11 skipped, 1 todo (§8). |
| 4 | `node tools/gates/validate.mjs --historical --stage DG5` (end) | `validate-dg5-end.log` | **0** | `PASS gate DG5 (historical)` |

## 5. Operations routed; pins

- **Operations routed: none.** `archiveEvidence` and `removeEvidenceLink` were already live; `archiveEvidence` is re-registered at the same path in the same module. There is no `p6-pending-be-f2.ts`, so the pending-list delta is none. `contract.test.ts` pins are unchanged: the contract adds no operation (922 operations per `openapi:lint`) and no request body.
- **Integration count change:** `integrity-sweep.test.ts` 19 → **23** tests (−2 `it.fails`, +4 new, +2 normal). `sensitive-reads.test.ts` stays at 15.

## 6. For the orchestrator: contract, schema, dependency, texts

- **Contract version.** I added an optional response property and changed descriptions; I did not change `info.version`. Bump it at merge if the convention asks for it.
- **The 409 response of `archiveEvidence` and `removeEvidenceLink`.** Both reference `VersionConflict`, whose description reads "If-Match is stale". The `Problem` schema validates `evidence.finalized`, but the text no longer covers every 409. Proposal (outside my named descriptions, so not changed): an inline 409 response on these two operations, described as "If-Match is stale (`version-conflict`), or the evidence supports an approved gate decision (`evidence.finalized`, `invalid-transition`)". ARCH-05 may also want to name `evidence.finalized` in ADR-0052 §9.1.
- **Provisional Arabic.** Both new Arabic texts are mine and **provisional**, pending a Mobily language review:
  - `evidence__finalized`: «هذا الدليل يدعم قرار بوابة معتمدًا، ولا يمكن أرشفته أو إلغاء ربطه.»
  - `export__includes_restricted_records`: «يتضمن هذا التقرير سجلات لا يمكنك الاطلاع عليها، لذا لا يمكن تصديره لك.»

  The label file `apps/web/src/i18n/provisional-ar-p6.ts` is not in my ownership. Its owner (frontend) should add `"problems.evidence__finalized"` and `"problems.export__includes_restricted_records"`. `problems-p6.test.ts` does not require them yet, because the codes are not in an ADR table.
- **No dependency need. No migration.**

## 7. User-facing texts, and what remains

**Texts made untrue: none found.**
- No en/ar string said that approved evidence can be archived, or that `includesRestrictedRecords` is planned.
- `access.includesRestrictedRecords` (FE-A) now has a contract-declared field. FE consumers can read it through the zod mirrors, which no longer reject it.

**What remains:**
1. The C.UTF-8 unit run (not run), and a clean full integration run (§8).
2. `dep-audit.vitest.mjs` fails until DO-A2's upgrades merge. That makes `pnpm test` exit 1 in every invocation, independent of this task.
3. Not in scope, noted for the orchestrator: the decide path does not re-check that the evidence of a pending submission is still active when it approves (an archive before the decision stays allowed). The 8 other list operations with the wrong order text (§2.4). The optional database guard (§2.1).

## 8. Final results

- **End of the task's own work:** `date -u` `Tue Oct 27 05:09:45 UTC 2026`.
- **The full integration run finished afterwards, at `05:24:54 UTC`.** I then read its summary and updated this section (`date -u` `05:24:59`).
- **Row 4, `validate --historical --stage DG5` (end):** `PASS gate DG5 (historical)`, **exit 0** (`validate-dg5-end.log`).
- **Row 2b, `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test`: NOT RUN.** I held it back while the integration run was in progress, because running the two together is what crashed attempt 1, and the time limit was reached.

### Row 3', the full integration run (alone, 04:07–05:24 UTC)

Log `integration.log` (the 05:10 partial copy is `integration-snapshot-0510.log`). **`exit=1`.**

> `Test Files  2 failed | 328 passed (330)` / `Tests  2 failed | 3301 passed | 11 skipped | 1 todo (3315)` / `Duration 4672.28s`

This task's files all passed in the full run:
- `hardening/integrity-sweep.test.ts` **23/23**;
- `access/sensitive-reads.test.ts` **15/15**;
- `access/sensitive-reads-ab-transcript.test.ts` **5/5**;
- `contract/contract.test.ts` **101/101** (pins unchanged).

The two failing files:
1. **`contract/response-validation.test.ts`, 107/109.** These are the same two failures BE-F reported in its own full run (T-DG6-BE-F handback §3, row 3), both in the second copy of the contract suite inside BE-F's file:
   - "P5 BE-J operations": `expected [] to have a length of 1 but got +0`, the BE-J seam not repeating in a database where `contract.test.ts` already ran it;
   - "every operation: an undeclared request media type …": `30002ms`, the test timeout under load.

   Neither involves this task's operations. The file's seven REQ-S16-027 checks passed.
2. **`apps/worker/test/integration/raid-corrective.test.ts`: suite setup failed, 10 tests skipped.** The error was `MigrationError: migration 0047_p4_adoption.sql failed: could not extend file "base/257038/2673": No space left on device` in `workerEnv()`, followed by `boss` undefined in `afterAll`. That is the disposable cluster's disk filling up on the shared host, an environment failure and not an assertion. The file is a worker test of the RAID queue, which this task does not touch.

**Pinned-count change:** the integration total includes `integrity-sweep.test.ts` going from 19 to 23 tests (§5).

**Acceptance status:**
- **1:** all five commands exit 0.
- **2: not met.** The locale-unset invocation exits 1, solely on DO-A's `dep-audit` advisory test (unit-web and nocodegen all passed); the C.UTF-8 invocation was not run.
- **3: not met as exit 0.** 2 failed files: BE-F's two known failures, and one disk-full setup failure.
- **4: met.**

**For the orchestrator:**
- Rerun 2b and 3 on a quieter host with enough free disk, after the DO-A2 merge.
- The BE-J seam in `response-validation.test.ts` needs its owner (BE-F's follow-up) to make it repeatable in a shared database.
