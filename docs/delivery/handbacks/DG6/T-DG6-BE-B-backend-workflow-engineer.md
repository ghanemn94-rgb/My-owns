# Handback T-DG6-BE-B (backend-workflow-engineer): `ReadScope`, the parity test, sensitivity and grants

- **Stage:** DG6 (P6 "Integration and system hardening"), BUILDING. Section: `docs/architecture/p6-work-split.md` §E/F.2.
- **Invocation:** `DG6-T-DG6-BE-B-backend-workflow-engineer-20261026T195849Z-3f5fa767` (session `3f5fa767-2af4-4bce-af89-a3a2eb69d664`).
- **Base:** branch `dg6/be-b`, `HEAD` `1c061ab8b9dae8ae5fce31dd261299024d014f56` (clean apart from the pre-existing untracked home-directory dotfiles). Changes are **uncommitted**, as the assignment requires.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-B.md`, sha256 `ab23a9186e596361b95f7dee3e22598063c57349757c6c1f99efb1e3b72ae958` (verified before starting).
- **Time:** started `2026-10-26T19:59:02Z`. That run was stopped by a container restart before it ended (D-198).
- **Continuation (T-DG6-BE-BB):** invocation `DG6-T-DG6-BE-BB-backend-workflow-engineer-20261026T213341Z-880b860b` (session `880b860b-1c6c-429c-bf19-37bf5226f57f`). Assignment `docs/delivery/assignments/DG6/T-DG6-BE-BB.md`, sha256 `8ad6ee9b3a23a6381150588c946fb05012573f03826e7f4bdab6ed9f91a087d1` (verified). Base: branch `dg6/be-b` at the salvaged WIP commit `e7f134d37e3679705450e9ff0a532950f56a297e`. Started `2026-10-26T21:44:10Z`; ended `2026-10-26T23:46Z` (the integration result was read at 23:45:45Z, about 2 minutes past the limit). Every section marked **[BB]** was changed or confirmed in this continuation; every check in §5 was rerun by the continuation.
- **Gate systems:** a sensitive-record grant is an access decision, never a business approval (G1–G6). No agent, seed or test here grants a business, Finance or IT approval. Nothing reads or writes DG0–DG7. All test data is synthetic.

## 0. Continuation review (T-DG6-BE-BB) [BB]

I reviewed the salvaged WIP against ADR-0051 §1, §2, §6, §7 and the work split §2 and §E/F.2, without assuming it was complete. What I found and did:

1. **The earlier final checks were not confirmed.** Its first `pnpm test` (locale unset) **failed** one test: the advisory-lock registry test "no module source outside the registry spells a class number" found `730300` in `access/sensitivity.ts`. A rerun log shows `unit-node` passing 2407/2407, but the C.UTF-8 log and the integration log end mid-run with no summary or exit code. The §5 table still had placeholders. Those logs are kept as `prior-run-*.txt`; the results in §5 come only from this continuation.
2. **Rule 4 / ADR-0051 §6 deviation, fixed.** The rule is "authorization re-checked at commit time (inside the transaction, **after the row lock**)". All three mutations re-checked before taking the `sensitiveRecordGrant` lock and the row lock. They now take the advisory lock and the row lock (`FOR UPDATE` on the flag or grant row) first, then reload the principal and re-run the gate (`access/sensitivity.ts`: `putRecordSensitivity`, `createGrant`, `revokeSensitiveGrant`).
3. **Missing test, added.** Commit-time re-authorization was tested for mark and grant but not for revoke. `sensitivity.test.ts` now has "a grant right revoked between load and commit: the revoke is 403 and nothing is written", which also checks the grant stays `active`, version 1, with only the `granted` audit event (22 tests in the file, was 21).
4. **No literal lock number in source.** My new comments name the lock by its registry key (`sensitiveRecordGrant`), never by its number, so the registry test stays green.
5. **Confirmed unchanged:** the refusal codes and texts (exactly ADR-0051 §2), the party columns, the structural lines, `config.consumes`, the routed operations, the pinned-count delta, and the user-facing text search (§7, rerun: no en/ar string calls these features planned).

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/modules/access/read-scope.ts` | ADR-0051 §1. `readScopeFor` (the `ReadScopeFactory`): `predicate` = `scopeFilter` AND the §2 sensitivity clause in SQL; `admits` = `decide` AND the same clause in memory. Also exports the pure clause (`sensitivityClauseAdmits`, `sensitivityClauseSql`), `activeGrantKeys`, `loadSensitivityFacts`, `recordKey` and the permission constants. BE-A's types are unchanged. |
| `apps/api/src/modules/access/sensitivity.ts` | ADR-0051 §2, §6, §7. **[BB]** the three mutations now lock before the commit-time re-check. `sensitiveAdmits`, `requireSensitiveRead` (404), `loadSensitiveRecord(s)`, `isMarkedSensitive`, `SENSITIVE_RECORD_PARTY_COLUMNS`, `sensitivityRefusals`, and the six routes. |
| `apps/api/src/modules/access/rules.ts` | The two `STRUCTURAL_PERMISSIONS` lines (`sensitive_record.grant`, `sensitive_record.read`), with a comment. |
| `apps/api/src/modules/access/index.ts` | Export lines for the `sensitivity.ts` helpers. `read-scope.ts` was already re-exported with `export *`. |
| `packages/shared/src/schemas/sensitivity.ts` | zod mirrors: `recordSensitivity`, `recordSensitivityUpdate`, `sensitiveGrant`, `sensitiveGrantPage`, `sensitiveGrantCreate`, `sensitiveGrantRevoke`, `sensitiveRecordType`, `sensitiveGrantStatus`. Free text uses the shared `reason` rule. |
| `apps/api/src/modules/access/read-scope.test.ts` | Unit tests (9): the in-memory clause (not sensitive, grant, other-record grant, party, null party, TO, AUD alone, service principal, decision counting) and the structural codes (ADM_ACCESS covers the two codes only, never `transformation.read`). |
| `apps/api/test/integration/access/read-scope-parity.test.ts` | The ADR-0051 §1 parity test (2 tests). |
| `apps/api/test/integration/access/sensitivity.test.ts` | Flags and grants end to end (22 tests; **[BB]** +1, commit-time re-authorization of revoke). |
| `apps/api/test/integration/contract/p6-exercises-be-b.ts` | Contract exercises of the 6 operations (success and every reachable refusal) and the `P6_MIRRORS_BE_B` map. |
| `apps/api/test/support/p6-pending-be-b.ts` | Emptied: all 6 operations are routed. |
| `apps/api/test/integration/contract/contract.test.ts` | **One pinned line plus a comment, outside my strict file list:** the JSON-body route count goes from `[391, 390, 1]` to `[394, 393, 1]`. See §5. |

No migration was added, so no new migration id is needed. No dependency was added.

## 2. Operations routed (delta to `p6-pending-be-b.ts`)

Removed from the pending list (6 → 0) and exercised in `p6-exercises-be-b.ts`:

| Operation | Route | Exercised statuses |
|---|---|---|
| `getRecordSensitivity` | `GET /api/v1/transformations/{transformationId}/records/{recordType}/{recordId}/sensitivity` | 200, 400, 404 |
| `putRecordSensitivity` | `PUT` same path (`IfMatchOrZero`) | 200, 400, 403, 404, 409, 422, 428 |
| `listSensitiveGrants` | `GET /api/v1/admin/sensitive-grants` | 200, 400, 403, 404 |
| `createSensitiveGrant` | `POST /api/v1/admin/sensitive-grants` | 201, 400, 403, 404, 409, 422 |
| `getSensitiveGrant` | `GET /api/v1/admin/sensitive-grants/{grantId}` | 200, 400, 404 |
| `revokeSensitiveGrant` | `POST /api/v1/admin/sensitive-grants/{grantId}/revoke` (`IfMatch`) | 200, 400, 403, 404, 409, 422, 428 |

Every route's `config.consumes` is `["application/json"]` on the three body-carrying operations; the GETs declare none (rule 3). Each route declares `config.access`. Bodies are parsed through the platform's strict-UTF-8 JSON parser (no route-local parser, rule 2).

## 3. Behaviour delivered, per requirement row

### REQ-S10-002 (BE-B share; BE-B2 and FE-B complete it)

Acceptance (quoted): *"A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant"*.

What BE-B delivers toward it:

- **Marking.** A benefit, business case or evidence item can be marked sensitive or unmarked (`putRecordSensitivity`).
  - `If-Match "0"` creates the flag row (version 1). A second `"0"` gives 409, a stale version 409, a missing header 428.
  - Unmarking is an UPDATE to `is_sensitive = false`, never a DELETE.
  - One audit event is written per mutation (`record_sensitivity.marked` / `.unmarked`) with prior and new version. The trigger writes the history row.
  - The business record's own version is unchanged (tested on the benefit).
- **Explicit grants.**
  - Grant (`createSensitiveGrant`): 201, `ETag "1"`, `Location`, audit `sensitive_record_grant.granted`.
  - Refusals: duplicate → 409 `sensitive_grant.duplicate`; self → 422 `sensitive_grant.not_self`; a grantee of another organization (or inactive) → 422 `sensitive_grant.grantee_not_in_organization`.
  - Revoke: 200 → `revoked`, audit `sensitive_record_grant.revoked` (prior 1, new 2). Revoking again → 422 `invalid_transition` "Only an active grant can be revoked.".
  - After a revocation, a new grant is a new row.
  - A reason that fails the shared rule (trimmed 3–1000, not blank) → 422 `sensitivity.reason_required` "Give a reason of 3 to 1000 characters." A missing or non-string reason → 400 (contract schema).
- **The §2 clause** (`sensitiveAdmits`, `requireSensitiveRead`, the ReadScope).
  - A principal who passes the ADR-0006 read is admitted to a sensitive record iff it holds an active grant, is a named party (exactly the ADR's columns per type), or holds `sensitive_record.grant` at the record's scope.
  - AUD alone admits nothing. A service principal is never a party.
  - Proven in the parity test and in `sensitivity.test.ts`: after marking, the non-party BO2 and the TL get 404 on the record's sensitivity read; the owner BO, TO and AUD (metadata) get 200. After a grant BO2 gets 200, and after the revocation 404 again on the next request.
- **ADM_ACCESS** (organization-level assignment) grants through the structural rule. Its grant response and its `getSensitiveGrant` show `recordTitle: null, recordTitleRedacted: true`, while TO sees the title. ADM_ACCESS still gets 404 on the benefit GET.
- **AUD:** 403 on `putRecordSensitivity`, `createSensitiveGrant` and `revokeSensitiveGrant`; 200 on `getRecordSensitivity`, `listSensitiveGrants` and `getSensitiveGrant`.
- **Not delivered here, by the work split:** the literal acceptance "a sensitive benefit is hidden from a workstream member without the grant" on the **benefit list and benefit GET**, plus the rollup label `includesRestrictedRecords`. Both are BE-B2 (§E/F.3), which adds `requireSensitiveRead` and the ReadScope to the benefit, business-case and evidence read routes. **Until BE-B2 merges, the existing benefit, business-case and evidence GET and list routes still return a sensitive record to an in-scope reader without admission.** BE-B ships the boundary and the flag, not the wiring into DG4/DG5 read routes, which the work split assigns to BE-B2.

### REQ-S10-004 (BE-B share: the port and parity; BE-B2 adds exports; search H and assistant D consume it)

Acceptance (quoted): *"A12: a user without access to transformation Y receives no Y records in search, export, evidence URL or AI retrieval; a user scoped to transformation X exports a portfolio report and receives no Y records, and search returns no Y hits"*.

- **`readScopeFor(db, principal, permission)`** is the one read boundary.
  - It loads the principal's active grants and the sensitive records of its organizations once per request, with no cross-request cache.
  - It returns `predicate` (SQL) and `admits` (in memory).
  - When a transformation-level row omits `businessUnitId`, the predicate derives it from the transformation, so business-unit grants apply exactly as in `decide`. The parity test covers both forms: evidence omits it, benefits pass it.
- **Parity test** (ADR-0051 §1). Fixture:
  - 2 organizations and the business units a1, nested a1x and sibling a2 (plus org B's b1).
  - 3 transformations: in a1x, in a2, and in org B.
  - The 14 seeded roles at organization A, at BU a1 and at transformation T1 (42 users), each transformation's TL and BO, a reader whose only assignment is revoked, and the six world users.
  - Per transformation, a benefit, a business case and an evidence item, each sensitive and non-sensitive (18 records). One non-sensitive item carries an explicit `is_sensitive = false` row.
  - Grants: active (a T1 WL on two records; a BU-level KDS who cannot read T1 at all) and revoked (a T1 SEC).
  - For every pair, predicate ⇔ admits ⇔ the record view. Printed: `[read-scope-parity] readers=55 records=18 pairs=990 admitted=116 view-by-GET=495 view-by-record-decision=495 mismatches=0`.
  - **The record view leg.** For the 495 non-sensitive pairs it is the real record GET (benefit, business case, evidence: 200 vs 404). For the 495 sensitive pairs it is the record-view decision those GETs will call: `requireTransformationRead` + `requireSensitiveRead`, called in process. The HTTP GETs do not call it until BE-B2 (see above).
  - BE-B2 should switch the sensitive pairs to the HTTP GET once its read lines land. The test's header says so.
- Export selection (`reporting/exports/jobs.ts`), search and assistant retrieval are not in BE-B's files. Their consumption of the ReadScope is BE-B2, H and D.

## 4. Design points the reviewers should know

1. **Who reads a flag** (`getRecordSensitivity`). Readers of the record (ADR-0006 read AND the §2 clause) can, and so can holders of `sensitive_record.read` or `.grant` on the transformation, because ADR-0051 §7 lists "List grants and flags (metadata)" under `sensitive_record.read`. Everyone else gets 404. The response carries no title.
2. **403 vs 404.**
   - Mutations: 404 when the caller cannot see the record (no read and no `sensitive_record.read`); 403 when it can see the record but lacks `sensitive_record.grant`. This is the ADR-0006 rule and ADR-0051 §2's table.
   - `listSensitiveGrants`: 403 when the caller reads the transformation but lacks `sensitive_record.read`, 404 otherwise.
   - `getSensitiveGrant` declares no 403 in the contract, so it answers 404.
3. **Commit time.** **[BB: reordered]**
   - Every mutation runs the management gate on the request-start principal (for the 404/403 shape), then validation and `If-Match`.
   - Inside the transaction, the 730300 `sensitiveRecordGrant` lock is taken first (`"<recordType>:<recordId>"`, the key the 0098 triggers use), then the row (`FOR UPDATE` on the flag or grant row). Only then does `refreshPrincipal` run and the gate run again on the reloaded grants, as rule 4 and ADR-0051 §6 require ("after the row lock").
   - A right lost since the request started is 403 (`commitTimeDenial`) and nothing is written. Tested for mark, grant and (**[BB]**) revoke (`afterIdentity` + `revokeAll`).
4. **Concurrency.** Two concurrent `If-Match "0"` creates give one 200 and one 409 with one row. Two concurrent duplicate grants give one 201 and one 409 with one active row. Both are tested.
5. **Problem codes and texts** are exactly ADR-0051 §2's: `sensitive_grant.not_self`, `sensitive_grant.grantee_not_in_organization`, `sensitive_grant.duplicate`, `invalid_transition`, `sensitivity.reason_required`, `not_found`, `forbidden`. No new code is needed.
6. **No remote I/O** happens in any transaction. Histories are trigger-written only.

## 5. Checks actually run

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. Disposable PostgreSQL 16.13 via `tests/qa/support/with-pg.sh` on ports 23800–23849. Before the final runs I removed the empty `.claude/.cc-writes` directories inside source folders (`rmdir`, empty only). Logs are in `docs/delivery/handbacks/DG6/T-DG6-BE-B-evidence/`.

**[BB]** Every row below was run by the continuation on the final tree (after its last source edit), between `2026-10-26T21:44Z` and `2026-10-26T23:46Z`. The earlier run's logs are kept, unchanged, as `prior-run-*.txt`. Its own final results were never confirmed (§0).

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` (continuation start; the earlier run's start log is `validate-historical-DG5.txt`) | 0 | `PASS gate DG5 (historical)` | `validate-historical-DG5-continuation-start.txt` |
| 1 | `pnpm -r typecheck` | 0 | clean | `typecheck.txt` |
| 2 | `pnpm -r build` | 0 | clean | `build.txt` |
| 3 | `pnpm lint` | 0 | 0 warnings | `lint.txt` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" in every batch | `prettier.txt` (first attempt: `prettier-first-attempt-exit123.txt`, see below) |
| 5 | `pnpm openapi:lint` | 0 | clean | `openapi-lint.txt` |
| 6 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` (locale unset) | 0 | unit-node 154 files, 2407/2407; unit-web 94 files, 1746/1746; unit-formula-nocodegen 3 files, 259 passed + 2 skipped (261) | `unit-locale-unset.txt` |
| 7 | `env LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | 0 | identical counts: 2407/2407; 1746/1746; 259 passed + 2 skipped | `unit-c-utf8.txt` |
| 8 | `env QA_PG_PORT=23820 MTH_PORT_POOL=23821-23849 tests/qa/support/with-pg.sh pnpm test:integration` (attempt 2, started `22:56Z`) | 0 | **Test Files 324 passed (324); Tests 3137 passed, 1 skipped (3138); Duration 2883 s.** The skip is pre-existing, in `governance/presentation.test.ts` (not my file). It includes `access/sensitivity.test.ts` 22/22, `access/read-scope-parity.test.ts` 2/2 and `contract/contract.test.ts` 101/101. Attempt 1 exited 1 on a worker crash with 0 failed tests (below). | `integration.txt` (complete); `integration-attempt2-snapshot-at-limit.txt` (a copy taken at `23:38:10Z`, when 234 files had passed); attempt 1: `integration-attempt1-worker-crash.txt` |
| 9 | `node tools/gates/validate.mjs --historical --stage DG5` (at the end, 2026-10-26T23:08:32Z) | 0 | `PASS gate DG5 (historical)` | `validate-historical-DG5-end.txt` |

The 2 skipped tests are inside `packages/shared/src/formula/fuzz.test.ts` (111 tests, 2 skipped). The same skips appear in the earlier run's log. That file is outside my scope and unchanged (rule 9).

**[BB] Non-zero exits in the continuation, all disclosed:**

- **Prettier, first attempt: exit 123** (`prettier-first-attempt-exit123.txt`). This was not a formatting failure. I had renamed four tracked evidence logs to `prior-run-*`, and two had not been re-created yet, so `git ls-files -c` listed files that were missing ("No files matching the pattern were found"). Every batch that ran said "All matched files use Prettier code style!". I restored `unit-locale-unset-rerun.txt` under its tracked name (it is an earlier-run log). The rerun on the final tree exits 0 (row 4).
- **Integration, attempt 1: exit 1** (`integration-attempt1-worker-crash.txt`). **No test failed:** 91 test files completed, every one passing, `contract.test.ts` 101/101 among them. Then a Vitest worker process died, `Unhandled Rejection: Error: Channel closed` (`ERR_IPC_CHANNEL_CLOSED`, tinypool `ProcessWorker.send`), and Vitest ended without a summary.
  - **Cause: not determined.** `dmesg` is not readable in the sandbox. The host had 16 GB, no swap and about 9 GB in use, shared with the three other concurrent W3 runs. That is consistent with a killed worker, but I cannot prove it.
  - I reran the identical command unchanged (row 8).
- **Integration, attempt 2: exit 0, finished just after the time limit.** The `integration` project runs every file in one fork, sequentially (`vitest.config.ts`, `singleFork`), and took 2883 s on this shared host. I took a snapshot at the ~2-hour limit (`23:38Z`: 234 files, 0 failed). The run completed at about `23:45Z` with 324/324 files and 3137 passed + 1 skipped. I read its final summary at `2026-10-26T23:45:45Z`, about 2 minutes past the assignment's limit, and recorded it here.
- **Targeted run** (`continuation-targeted-sensitivity-parity.txt`): `sensitivity.test.ts` + `read-scope-parity.test.ts` on a disposable PostgreSQL (port 23800), **exit 0, 24/24** (22 + 2). The parity line: `readers=55 records=18 pairs=990 admitted=116 view-by-GET=495 view-by-record-decision=495 mismatches=0`.
- I caught one error before any run: my first comments for the lock reorder spelled the lock class number, which the advisory-lock registry test forbids (the same failure as the earlier run's first `pnpm test`). I replaced it with the registry key before any check ran.

**Earlier run (T-DG6-BE-B), for the record:**

Non-zero exits during development:

- The first `pnpm -r typecheck` exited 2. `read-scope.test.ts` passed a `readonly Grant[]` where `Grant[]` was typed (my earlier `tsc -p apps/api` had not covered that file). I fixed the helper's parameter type, and the rerun exits 0.
- The first prettier check exited 123 on my 5 new or changed files. I ran `prettier --write` on those 5 files only, and the rerun exits 0.
- **[BB, found in its logs]** Its first full `pnpm test` (locale unset) exited 1. The advisory-lock registry test found the lock number spelled in `access/sensitivity.ts` (`prior-run-unit-locale-unset.txt`). The fix was in the WIP commit, and its rerun shows unit-node 2407/2407 (`unit-locale-unset-rerun.txt`). Its C.UTF-8 and integration logs end without a summary (`prior-run-unit-c-utf8.txt`, `prior-run-integration.txt`), so they prove nothing either way.
- The first targeted run of `contract.test.ts` failed one test. "Every route accepts exactly the request media types its operation declares" expected `[391, 390, 1]` and got `[394, 393, 1]`. The +3 are my three JSON-body operations, so I updated the pin with a comment (below).

Targeted runs during development, all on a disposable PostgreSQL:

- `sensitivity.test.ts`: 21/21 passed.
- `read-scope-parity.test.ts`: 2/2 passed, with 990 pairs and 0 mismatches.
- `contract.test.ts`: 100/101 before the pin update.
- `read-scope.test.ts` (unit): 9/9 passed.

**Pinned-count change [BB: confirmed, unchanged by the continuation] (for the orchestrator's W3 reconciliation, rule 16):** in `contract.test.ts`, the "request media types" pin goes `[391, 390, 1]` → `[394, 393, 1]` (+3 JSON bodies: `putRecordSensitivity`, `createSensitiveGrant`, `revokeSensitiveGrant`).

- The operation count is unchanged: the operations were already in the contract.
- There is no new rate-limit class and no CSRF-exempt route.
- BE-E's routes in W3 will move the same pin, so expect a one-line merge conflict on that line. The right value is 391 + every W3 task's JSON-body delta.

## 6. Contract, schema and dependency needs

- **None for the contract.** The 6 operations match `docs/api/openapi.yaml` 1.5.0-p6 as written. The validating client checks every response, and the zod mirrors check every success body.
- **For BE-E (audit redaction):** consume `sensitiveAdmits(db, principal, recordType, recordId, target, parties)`, or `readScopeFor(...).admits` for many rows, from `access/index.ts`.
- **For BE-B2:** `requireSensitiveRead(db, principal, recordType, recordId, target, parties)` after `requireTransformationRead`. For lists, use `readScopeFor(db, principal, "transformation.read").predicate({...})` with the party columns in `SENSITIVE_RECORD_PARTY_COLUMNS`.
- **No dependency** is needed. **No migration** was added (none in the continuation either), so no migration id is claimed.
- **[BB] For the orchestrator:** `contract.test.ts` is outside §E/F.2's file list. Its one pinned line moved because rule 16 requires the contract test to stay green (§5).

## 7. User-facing texts made untrue

None (**[BB]** search rerun, same result). I searched `apps/web/src/i18n/**` and the user documentation for texts that call sensitive records or grants planned or later, and found none. The only "sensitivities" string (`businessCases.json` "Risks and sensitivities") is unrelated. The texts for the new problem codes and the Administration > Sensitive grants page belong to FE-A and FE-B (§E/F.12).

## 8. What remains

- **BE-B2** (§E/F.3, the separable second half; not part of this task):
  - wire `requireSensitiveRead` and the ReadScope into the benefit, business-case and evidence-metadata read and list routes;
  - add `includesRestrictedRecords` on the aggregates, plus its inventory;
  - add the ReadScope line in `reporting/exports/jobs.ts`;
  - write the REQ-S10-002 literal list/GET test and the byte-identical regression transcripts;
  - switch the parity test's sensitive pairs to the HTTP GET.
- Until BE-B2 merges, a sensitive record is still returned by those DG4/DG5 read routes to an in-scope reader without admission (see §3).
- **[BB] Acceptance check 3** passed in the continuation (attempt 2, exit 0; §5 row 8). No pinned count changed beyond the one in §5.
- Nothing else in §E/F.2 remains.
- **[BB] Document inconsistency, for the orchestrator.** ADR-0051 §1 says "`reporting/exports/jobs.ts`: BE-B adds the `ReadScope` line", and §2 calls the aggregate inventory "BE-B's inventory". The work split §E/F.3, which the assignment makes binding for file ownership, gives both to **BE-B2**. I followed the work split and did not touch `reporting/**`. The ADR wording could be aligned when BE-B2 is assigned.

## 9. Merge instructions

- No migration and no ordering constraint beyond the work split: BE-B before BE-B2, BE-J and BE-P.
- Expected conflict: the single pinned line in `contract.test.ts` (§5).
- `access/rules.ts` is edited only by BE-B (§E/F.13).
