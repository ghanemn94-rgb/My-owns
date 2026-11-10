# Handback T-DG6-AN-P6A (transformation-analyst): DG6 register update, half A

- **Stage:** P6 "Integration and system hardening", gate DG6 (BUILDING). Task T-DG6-AN-P6A.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-AN-P6A-transformation-analyst-20261031T033412Z-4a7ea3b2","session_id":"4a7ea3b2-6eed-47e7-9b10-b45995132fb0"}`
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-AN-P6A.md`, sha256 `9619e3b5e5c0eb0f39ea79ae7ce685474d626e1a652e396b4dcef972525f9fde`. I verified it with `sha256sum` before starting.
- **Tree:** worktree `/home/user/wt/dg6-an-p6a`, branch `dg6/an-p6a`, `HEAD` = `bc5bb7b32e16c37e41e99a769a5143646c2ec4e2`, clean at the start. My changes are **uncommitted**, as the assignment asks.
- **Time:** start `Sat Oct 31 03:34:28 UTC 2026`, end `Sat Oct 31 03:46:02 UTC 2026` (both from `date -u`). Every row was reached.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, **exit 0**. I ran it at the start, before any edit, and again at the end with the same result.
- I approved nothing. No business (G1–G6), Finance or IT approval was granted, and product G6 does not imply DG7.

## 0. Summary

| | Count |
|---|---|
| Rows assigned (all `final_gate` DG6) | 24 |
| Set to **IMPLEMENTED**, with evidence | **22** |
| Left **SPECIFIED** as **real gaps** | **2**: REQ-S12-019 and REQ-S15-014 (§4) |
| IMPLEMENTED, but a clause is only partly covered or rests on implementer tests only (disclosed in `notes`) | 9: REQ-S02-006, S10-004, S13-013, S15-007, S15-011, S15-012, S15-013, S16-007, S16-022 (§3) |
| Later-gate rows with a P6 increment that got a pointer | 0 (§5) |
| Evidence paths written | 336. All exist as regular files, 0 missing (§2.4). |

**My rows by class (counted from the register):**

| Class | Rows | IMPLEMENTED | SPECIFIED |
|---|---|---|---|
| ENGINEERING | 12 | 12 | 0 |
| USER | 12 | 10 | 2 |
| SOURCE | 0 | 0 | 0 |

All 24 rows have `final_gate` DG6. No class, title, source_ref, acceptance, increments or final_gate changed.

**Assignment discrepancy (reported, not guessed):** the Task section says "for each of your **36** rows", but the title and the list give **24**. I worked the 24 listed rows.

**Records the assignment cites that are not in this tree:** D-202 (option (a), the A17 linked-KPI reader) is not in `docs/delivery/decisions.md`; the newest entry there is D-201. I took D-202's content from `docs/delivery/assignments/DG6/T-DG6-QA-A2.md` and the QA-A2 handback.

## 1. Changed files

| File | Purpose |
|---|---|
| `docs/delivery/requirements.csv` | My 24 rows only. 22 rows: `status` → IMPLEMENTED, `evidence` filled, one "DG6 analyst check (T-DG6-AN-P6A, base bc5bb7b32): …" sentence appended to `notes`. 2 rows (the gaps): `status` stays SPECIFIED, `evidence` stays empty, and one sentence stating the gap is appended to `notes`. Existing notes are kept as the prefix. |
| `docs/delivery/handbacks/DG6/T-DG6-AN-P6A-transformation-analyst.md` | This handback. |

No `docs/analysis/**` file was needed. The update script and the verification script are in my run's scratch area (not committed). Their output is pasted in §2.

## 2. Checks actually run (exact commands, real exit codes)

Environment: Node v24.21.0, Python 3 (`-I`), offline sandbox, worktree at `bc5bb7b32`.

### 2.1 `node tools/gates/validate.mjs --register DG6` → **exit 1** (expected at this point)

```
FAIL register rules at DG6 (52 problems)
  - requirements.csv REQ-DLV-038: final gate DG6 requires IMPLEMENTED at DG6 (is SPECIFIED)
  - requirements.csv REQ-DLV-038: IMPLEMENTED for DG6 without evidence
  - requirements.csv REQ-S12-019: final gate DG6 requires IMPLEMENTED at DG6 (is SPECIFIED)
  - requirements.csv REQ-S12-019: IMPLEMENTED for DG6 without evidence
  - requirements.csv REQ-S15-014: final gate DG6 requires IMPLEMENTED at DG6 (is SPECIFIED)
  - requirements.csv REQ-S15-014: IMPLEMENTED for DG6 without evidence
  - requirements.csv REQ-S16-029 … REQ-S16-030 … REQ-S16-032 … REQ-S17-001 … REQ-S17-002 … REQ-S17-003 …
    REQ-S17-005 … REQ-S17-006 … REQ-S17-007 … REQ-S17-008 … REQ-S17-009 … REQ-S17-010 … REQ-S17-011 …
    REQ-S20-001 … REQ-S20-012 … REQ-S20-013 … REQ-S20-014 … REQ-S20-017 … REQ-S20-020 … REQ-S20-021 …
    REQ-S20-022 … REQ-S20-029 … REQ-S20-030 (two lines each, same two messages)
```

There are 26 distinct failing rows (classified by a script over the full output):

- **24 are not mine:** the 23 half-B rows (S16-029, S16-030, S16-032, S17-001/002/003/005/006/007/008/009/010/011, S20-001/012/013/014/017/020/021/022/029/030) and REQ-DLV-038.
- **2 are mine, deliberately:** REQ-S12-019 and REQ-S15-014, the real gaps of §4.

None of my 22 IMPLEMENTED rows is listed. So `--register DG6` **cannot PASS** even after half B and REQ-DLV-038 are done, until the two gaps are repaired and their rows updated.

### 2.2 Earlier gates

| Command | Exit | Output |
|---|---|---|
| `node tools/gates/validate.mjs --register DG4` | 0 | `PASS register rules at DG4` |
| `node tools/gates/validate.mjs --register DG3` | 0 | `PASS register rules at DG3` |
| `node tools/gates/validate.mjs --register DG2` | 0 | `PASS register rules at DG2` |
| `node tools/gates/validate.mjs --historical --stage DG5` (start and end) | 0 | `PASS gate DG5 (historical)` |

### 2.3 CSV integrity and "only my rows" (`python3 -I verify.py`, exit 0)

The script parses with `csv.reader(strict=True)`, compares against `git show HEAD:docs/delivery/requirements.csv`, and checks every evidence path.

```
[integrity] rows incl. header: 413 base: 413 column counts: [19]
[integrity] canonical re-serialisation identical to file: True
[integrity] DictReader parses 412 records
[diff] changed rows: 24 outside my 24: [] mine unchanged: []
[diff] changed columns: ['evidence', 'notes', 'status'] | every old note kept as prefix: True
```

Before editing, I confirmed that a csv-module round-trip of the base file was byte-identical (`'\n' True`). So the rewrite changes no quoting or line ending of any other row.

### 2.4 Every evidence path exists (same script)

```
  REQ-S01-005 IMPLEMENTED  15 evidence paths     REQ-S15-007 IMPLEMENTED  13 evidence paths
  REQ-S02-006 IMPLEMENTED  15 evidence paths     REQ-S15-009 IMPLEMENTED   9 evidence paths
  REQ-S10-002 IMPLEMENTED  19 evidence paths     REQ-S15-010 IMPLEMENTED  35 evidence paths
  REQ-S10-004 IMPLEMENTED  18 evidence paths     REQ-S15-011 IMPLEMENTED  15 evidence paths
  REQ-S12-019 SPECIFIED     0 evidence paths     REQ-S15-012 IMPLEMENTED  14 evidence paths
  REQ-S12-023 IMPLEMENTED  18 evidence paths     REQ-S15-013 IMPLEMENTED  15 evidence paths
  REQ-S12-024 IMPLEMENTED  12 evidence paths     REQ-S15-014 SPECIFIED     0 evidence paths
  REQ-S13-011 IMPLEMENTED  16 evidence paths     REQ-S16-006 IMPLEMENTED  19 evidence paths
  REQ-S13-013 IMPLEMENTED  13 evidence paths     REQ-S16-007 IMPLEMENTED  16 evidence paths
  REQ-S15-001 IMPLEMENTED  12 evidence paths     REQ-S16-022 IMPLEMENTED   9 evidence paths
  REQ-S15-003 IMPLEMENTED  17 evidence paths     REQ-S16-023 IMPLEMENTED   8 evidence paths
                                                 REQ-S16-026 IMPLEMENTED  16 evidence paths
                                                 REQ-S16-027 IMPLEMENTED  12 evidence paths
[evidence] 336 paths checked, 0 missing
[status] my rows: {'IMPLEMENTED': 22, 'SPECIFIED': 2}
```

(I re-laid the per-row lines in two columns here; the content is the script's.) The update script also refuses to write if any path is not a regular file (`os.path.isfile`). Every entry is a plain path with no fragment and no directory.

### 2.5 `git status --short` / `git diff --stat`

```
 M docs/delivery/requirements.csv
 docs/delivery/requirements.csv | 48 +++++++++++++++++++++---------------------
 1 file changed, 24 insertions(+), 24 deletions(-)
```

This handback is the only other file, and it is untracked.

### 2.6 Analyst probe (read-only; **not test evidence**)

REQ-S15-007's literal strings are not used by any repository test (§3). So I called the product's `markLtrStretches` (`packages/reporting/src/layout/bidi.ts`) through `node --experimental-strip-types` from a scratch script, on the literal strings:

```
"مؤشر KPI-001 بنسبة 12.5%" -> "مؤشر <LRM>KPI-001<LRM> بنسبة <LRM>12.5%<LRM>"
"12.5%" -> "<LRM>12.5%<LRM>"
"KPI-001" -> "<LRM>KPI-001<LRM>"
```

This shows the behaviour exists. It is not a repository test and is not cited as evidence.

### 2.7 Tests not run by me

I ran no product test suite. My evidence for "the test passes" is the merged-tree runs recorded by others, which I read:

- QA-A2's whole `tests/qa` run, `vitest-tests-qa-full-per-file.txt`: 41/42 files pass; the one failure is A17 "failing connector".
- QA-C log 32, QA-D `e2e-final-run.log` (exit 0), FE-D2 run 2, FE-F2's e2e log, FE-F2's keyboard log, FE-D register run 4.
- BE-X3B's final full integration run (3 failed files of 402, explained in its §4).

Some of those runs predate the last repair merges (BE-X3B, FE-X1B). The full freeze run is QA-E's (REQ-DLV-038).

## 3. Rows changed: acceptance clause → asserting test

Before citing each test, I opened it and checked its assertion against the binding clause.

| Row | Binding acceptance (abridged) | Test that asserts it | Status / caveat |
|---|---|---|---|
| REQ-S01-005 | task complete → Unconfirmed; filename-only link does not confirm; reviewed evidence or test-adapter confirmation sets it and records the source | `tests/qa/integration/a17-s01-005-external-change.test.ts` (4 `it`s, one per clause; 4/4); `apps/api/test/integration/portfolio/deliverable-confirmation.test.ts` (14) | IMPLEMENTED |
| REQ-S02-006 | direct API calls with invalid/unauthorized input rejected; clearing browser storage loses no submitted data | `apps/api/test/integration/hardening/route-inventory.test.ts` (484 unsafe operations × 401/CSRF 403/403-404/400, nothing persisted); `tests/qa/integration/a12-p6-scope-isolation.test.ts`; `apps/web/e2e/p6-draft-recovery.spec.ts` (`localStorage.clear()`, `sessionStorage.clear()`, reload, the draft comes back from the server, saved and read back through the API) | IMPLEMENTED. The storage clause rests on the frontend e2e only; QA-B lists it as not covered by QA. |
| REQ-S10-002 | BO on X gets 403/404 on Y; sensitive benefit hidden from a WL without the grant | `a12-p6-scope-isolation.test.ts`: "a Business Owner on X reads no Y record…", "after marking, it is 404 and absent from list, search, assistant and links", "an explicit grant admits the WL; revoking it hides the record again"; `apps/api/test/integration/access/sensitive-reads.test.ts` | IMPLEMENTED |
| REQ-S10-004 | no Y in search, export, evidence URL, AI retrieval; X's portfolio report export has no Y; search no Y hit | `a12-p6-scope-isolation.test.ts` (search ×4, exports ×2, evidence URLs, assistant retrieval); `read-scope-parity.test.ts` (990 pairs, 0 mismatches); `search-parity.test.ts` | IMPLEMENTED. **Interpretation disclosed:** there is no cross-transformation "portfolio report" export (D-199 item 2; QA-B O3). The clause is met as X's own register export carrying no Y record, with every Y export refused. A member without admission is refused (403) a register export that would hold a sensitive record (BE-B2 §8 item 1). |
| REQ-S12-023 | no email adapter configured → all workflows complete, notifications in the inbox | `tests/qa/integration/a21-p6-adapters-disabled.test.ts` (fan-out `no_channel`, no delivery row, 0 SMTP, in the inbox; 10/10); `e2e/a21-p6-degradation.spec.ts` (no channel configured, en/ar); `a02-a21-complete-lifecycle.test.ts` (13/13) | IMPLEMENTED |
| REQ-S12-024 | forwarded link opened by an unauthorized user → 403 without the title | `apps/api/test/integration/tasks/deep-links.test.ts` ("…403 deep_link.forbidden, without the title"; byte-identical body for 3 targets); `a12-p6-scope-isolation.test.ts` "A12 deep links"; `e2e/a12-p6-scope-isolation.spec.ts` A12-2 | IMPLEMENTED |
| REQ-S13-011 | .exe and oversized rejected; SVG with script not executed in preview | `apps/api/test/integration/evidence/preview.test.ts` (422 `evidence.type_not_allowed`, 413 `evidence.too_large`, SVG preview 422 `evidence.preview_unavailable`, download octet-stream + attachment); `a12-p6-scope-isolation.test.ts` "uploads: …" | IMPLEMENTED |
| REQ-S13-013 | no access to the parent → 403 on the download URL; after BAU handover the new owner downloads | `a12-p6-scope-isolation.test.ts` "an in-scope reader not admitted gets 403 evidence.parent_forbidden on the download URL" (passes since BE-X1); `apps/api/test/integration/evidence/ownership-transfer.test.ts` (c) and (e) | IMPLEMENTED. The handover download is the implementer's test (c) only; QA-B lists it as not covered by QA. The outsider keeps the DG2 404 (D-196 item 1). |
| REQ-S15-001 | en/ar executive and home at 1440 px: decisions, outcomes, next actions without scrolling; light surfaces, blue navigation | `e2e/a20-p6-layout-brand.spec.ts` "home page", "executive page" (en, ar); `apps/web/e2e/p6-layout-1440.spec.ts` | IMPLEMENTED. QA-D: Outcomes and Next actions were checked in their empty states (no seeded data). |
| REQ-S15-003 | contrast test lists every pair and passes; no white small text on #0078FF for action buttons; chips distinguishable in greyscale | `tests/qa/unit/a20-p6-token-contrast.test.ts` (+ `unit/contrast-pairs.txt`); `e2e/a20-p6-ux.spec.ts` greyscale chips; BE-W `contrast.test.ts`; FE-F `Badges.test.tsx`, `status-tokens.test.ts` | IMPLEMENTED. WCAG thresholds are an implementation assumption; #0078FF is provisional. |
| REQ-S15-007 | no missing ar/en key; API validation error in the selected language; Arabic export keeps 'KPI-001' and '12.5%' readable | `tests/qa/unit/a20-p6-i18n-catalogue.test.ts`; `e2e/a20-p6-ux.spec.ts` "an error returned by the API is shown in the selected language"; `packages/reporting/src/layout/layout.test.ts`, `pdf/pdf.test.ts` | IMPLEMENTED, **export clause partly covered.** The tests assert the same LTR isolation with `RAID-014`, `1,250.50` and `-200.25 SAR`, not the literal strings, and QA-D lists the export clause as not covered (A15). The API error used is a 4xx business-rule refusal, not a field-validation 400. Probe in §2.6. |
| REQ-S15-009 | e2e at 360 px approve a gate item and submit a KPI actual, en and ar | `e2e/a20-p6-ux.spec.ts` "360 px: the Sponsor approves … G1", "360 px, keyboard alone: the KPI owner submits a KPI actual"; `apps/web/e2e/p6-flows-360.spec.ts` | IMPLEMENTED |
| REQ-S15-010 | search scoped to X returns no Y; bulk update with a stale record → conflict for that record only; draft survives reload | `a12-p6-scope-isolation.test.ts` "A12 search" (4); `tests/qa/integration/a14-p6-bulk-compare-reapply.test.ts` (2 errors at `/items/0/version`, `/items/3/version`); `bulk-conflict-p6.test.ts`; `apps/web/e2e/p6-draft-recovery.spec.ts` | IMPLEMENTED. The bulk is all-or-nothing, which D-199 item 1 accepts as "conflict for that record only". The draft clause rests on the frontend e2e (QA-B/QA-C: not covered by QA). |
| REQ-S15-011 | six states rendered by component tests; 'Draft - not submitted' label; drafts never counted in approved totals | `apps/web/src/components/six-states.test.tsx` (6 states × en/ar); `draft-recovery.test.tsx` and `p6-draft-recovery.spec.ts` (literal badge); `apps/api/src/modules/forms/form-draft-readers.test.ts` (static: only `forms/drafts.ts` reads `form_draft`) | IMPLEMENTED. "Never counted" rests on a static reader scan, not on a totals test. Older lifecycle chips use the en-dash variant `Draft – not submitted`. QA-C/QA-D: not covered by QA. |
| REQ-S15-012 | axe: no serious/critical on key screens; guided walkthrough completed by keyboard alone | `e2e/a20-p6-axe.spec.ts` (37 screens × 2 viewports × en/ar, 0 violations); `apps/web/e2e/p6-walkthrough-keyboard.spec.ts` (demo stack, 2 passed); keyboard journeys in `e2e/a20-p6-ux.spec.ts` | IMPLEMENTED, **partly covered:** 9 detail screens skipped by the axe spec (QA-D §4). The keyboard spec reaches all 12 step links but performs only steps 1 and 10. |
| REQ-S15-013 | 1,000 initiatives: sort, filter, page, hide a column work; API paginates | API: `tests/qa/integration/a20-p6-register-1000.test.ts` (4/4). UI: `apps/web/e2e/p6-register-1000.spec.ts` (FE-D run 4, exit 0) | IMPLEMENTED. The UI half is FE-D's e2e; QA-D lists it as not covered by QA. |
| REQ-S16-006 | contract tests pass for both adapters; evidence never served from a public URL | `apps/api/test/integration/evidence/store-contract.test.ts` (filesystem + S3 adapter against the in-process SigV4-verifying fake); `a12-p6-scope-isolation.test.ts` "evidence bytes are served only through the authenticated API" | IMPLEMENTED. The live IT object store is a disclosed residual (D-195 Q6). The S3 contract test is the implementer's. |
| REQ-S16-007 | e2e login through the Keycloak test realm; token from another realm rejected | `apps/api/test/integration/identity/other-realm.test.ts` (other issuer, audience, key, forged kid, bad azp). `e2e/identity/keycloak-login.spec.ts` is delivered but **never ran on Keycloak** (BLOCKED, no container runtime); it passed only against a stand-in IdP (DO-B §3.3) | IMPLEMENTED **under the disclosed BLOCKED residual** that D-195 Q5 and D-197 item 1 (D-049) pre-decided. Reviewers should judge the e2e clause against that decision; it needs a host with Docker (an A18 check). |
| REQ-S16-022 | ERD and migrations contain the 7 entities; an integration test creates and reads each through the API with authorization | `docs/architecture/erd.md` §2.12; `apps/api/test/integration/integrations/s16-022-entity-group.test.ts` (6 tests covering all 7) | IMPLEMENTED. Implementer evidence only; QA-C lists the 7-entity matrix as not covered by QA. ERD maps FormSchemaVersion → `methodology_version` and Notification → `inbox_notification` (ADR-0055 §7 correction). |
| REQ-S16-023 | deleting an approved gate decision or its evidence → 409; illegal transition → 422 invalid-transition; duplicate key → 409 | `apps/api/test/integration/hardening/integrity-sweep.test.ts` parts 1–4 | IMPLEMENTED. **Interpretation disclosed (ADR-0052 §9):** no delete route exists for decisions or evidence. `mth_app` DELETE fails (42501), and unlinking or archiving the evidence returns 409 `evidence.finalized`. |
| REQ-S16-026 | second save 409; UI offers compare and reapply without losing the first change | `a14-p6-bulk-compare-reapply.test.ts`; `e2e/a14-compare-reapply.spec.ts` (en/ar, 4 passed); `apps/web/e2e/p6-compare-reapply.spec.ts` | IMPLEMENTED. Comparison values are shown only to `audit.read` holders (D-199 item 6). |
| REQ-S16-027 | responses validated against OpenAPI; uniform 400; unauthorized 403 | `apps/api/test/integration/contract/response-validation.test.ts`; the contract harness under `a12-p6-scope-isolation.test.ts`; `p6-exercises-be-x1.ts` | IMPLEMENTED. QA-B's D1 (undeclared 403) was repaired by BE-X1. |

## 4. Real gaps: rows left SPECIFIED (findings for the orchestrator to repair)

### 4.1 REQ-S12-019: the operational exception loses the KPI's last known value (QA-A2-F1, still open)

- **Acceptance:** "A17;A22: a failing test connector produces one exception and the KPI shows Stale with its last value and date". Row: "retain last known values with freshness labels".
- **What passes:** exactly one exception; the KPI panel shows Stale with 250.75 and 2026-01-31; the admin sees the count only; the outsider is refused; no data change.
- **What fails at `bc5bb7b32`:**
  - `tests/qa/integration/a17-import-and-integration.test.ts` › "failing connector …" and `e2e/a17-failing-connector-exception.spec.ts` (en, ar) fail deterministically.
  - When a later reporting period is open (the real-world case), `GET /admin/operations/exceptions/{id}` gives the data owner `freshness "unknown"`, `lastValue null`, `lastValueAt null`.
- **Cause (QA-A2 §4):** `apps/api/src/modules/operations/exceptions.ts` `linkedKpiStatus` reads only the organization's newest period. That file is unchanged since BE-K (`git log` shows only `da0569607`).
- **Still failing after the repair waves:** BE-X3B §4 ("pre-existing and deterministic"), FE-X1B, and DO-G's `checks/rerun-a17.log`.
- **Repair:** a product fix (QA-A2's repair probe R shows the test passes once the newest period *with an evaluation* is used), or an ADR-0053 §2 ruling. No test change is expected. After that, re-run the A17 file and the A17 e2e, and the row can be updated.
- **Proposed severity:** as QA-A2 proposed, High with `mandatory_violation: true`. The orchestrator allocates and decides.

### 4.2 REQ-S15-014: "non-admin screens show no stack traces or infrastructure terms" has no test

- **Acceptance:** "A05;A20: the weighted score and benefit realized value show plain-language explanations in en and ar; non-admin screens show no stack traces or infrastructure terms".
- **Clause 1 is met:** `apps/web/src/components/explanation/explanation.test.tsx` covers E1/E2 in en and ar, with the ADR-0061 §8 words verbatim, on KBE-B's `packages/shared/src/explain/**`.
- **Clause 2 has no executable evidence:** ADR-0061 §8 assigns the term scan of every non-admin screen (stack-frame pattern, `node_modules`, `ECONNREFUSED`, `ETIMEDOUT`, SQL, …) to QA-D. QA-D's handback lists REQ-S15-014 as **NOT COVERED** (time limit). I found no other test that scans rendered screens for these terms. `grep` over `e2e/`, `apps/web/e2e/` and `tests/` finds the terms only in two shell scripts and the DG-reference text scan. FE-F's handback says the scan is not FE-F's.
- **Design that likely meets it, untested:** `ErrorState` (`apps/web/src/components/States.tsx`) shows only a translated message and a request reference.
- **Repair:** a QA test, the ADR-0061 §8 term scan on the §7.2 non-admin routes in en and ar. QA-E or a QA follow-up could add it before the freeze.

## 5. Later-gate rows with a P6 increment (half A only)

There are 39 rows with `P6` in `increments` and `final_gate` DG7. I searched every DG6 implementer handback and every DG6 QA handback for each of their IDs.

- Only QA-A's handback names any of them: REQ-S17-004 ("indirectly", connectors stay `not_verified`) and REQ-S19-007 ("NOT COVERED: a DG7 handover item").
- Neither names a delivered P6 increment.

So I added **no** pointer, and none of the 39 rows changed (§2.3).

## 6. Known gaps / not done

- The two real gaps in §4.
- The partial-coverage caveats in §3, each recorded in the row's `notes`. Rows whose clause rests only on the implementer's or frontend's own tests: S02-006 (storage), S13-013 (handover), S15-010 (draft), S15-011, S15-013 (UI), S16-006 (S3 contract), S16-022.
- REQ-S16-007's live Keycloak e2e is BLOCKED (environment; D-197). It was not run by anyone.
- I ran no product test (§2.7). The pass/fail statements come from the cited logs, which I read but did not re-run.
- REQ-DLV-038 was not touched, as the assignment says.

## 7. Merge instructions

- One file to merge: `docs/delivery/requirements.csv`, changed in my 24 rows only, in columns `status`, `evidence` and `notes`.
- Half B (T-DG6-AN-P6B) edits other rows of the same file. Line-level merges should not conflict, because each row is one line and the halves touch disjoint lines. If git conflicts anyway, take both sides row by row.
- No migration, no ordering constraint.
- After the merge, `--register DG6` will still list REQ-S12-019 and REQ-S15-014 until §4 is repaired. Updating those rows will need a short follow-up analyst task, like the one planned for REQ-DLV-038.
