# Handback T-DG5-BE-V2C (backend-workflow-engineer): F-DG5-101's rule on the step evidence link

- **Stage / gate:** P5, DG5, FIXING after review round 1 (D-170). This continues T-DG5-BE-V2B (D-147/D-151 salvage) and covers T-DG5-BE-V2B's whole scope.
- **Invocation:** `DG5-T-DG5-BE-V2C-backend-workflow-engineer-20261018T063244Z-21f037e7`, session `21f037e7-381b-4a06-b47b-435bfb8a6c87`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-V2C.md`, sha256 `6c33d6f5…0b2b` (verified).
- **Working tree:** `/home/user/wt/dg5-be-v2`, branch `dg5/be-v2`, `HEAD` = WIP `1773a24` (on `acf4629`).
- **Changes:** left **uncommitted**, as asked.
- **Time:** started `2026-10-18T06:41:47Z`, ended `2026-10-18T07:02:59Z` (`date -u`, after the handback's own prettier check, exit 0).
- **Approvals:** none granted. No business, Finance or IT approval was granted. Every value in the tests is synthetic, and nothing here relates to DG0–DG7.

## Preceding gate

- **Command:** `node tools/gates/validate.mjs --historical --stage DG4`
- **Result:** exit **0**, `PASS gate DG4 (historical)` (`T-DG5-BE-V2C-evidence/validate-dg4-historical.log`).

## What the WIP held, and what I changed

**The WIP `1773a24` (T-DG5-BE-V2B, unverified at salvage) held:**

1. **`apps/api/src/modules/procedures/steps.ts`.** `linkEvidence` now always loads the named evidence row; before, it did so only for an organization-scope instance. The org-scope "evidence belongs to T" check is unchanged. It then calls `requireOutputRead(tx, acting.principal, ev.transformation_id)` for any existing evidence row; an unknown id is left to the 0069 link guard, as before. `requireOutputRead` is imported from `./outputs/kit.ts`.
2. **`apps/api/test/integration/procedures/evidence-link-read-authorization.test.ts`.** Two tests on an adopted intake step: the refusal, and the positive path.
3. **Logs** in `T-DG5-BE-V2B-evidence/`. Per the assignment, I did not use them as evidence.

**My review of the WIP diff against the scope:**

- **In scope:** it uses the same check as BE-V2.
  - It runs inside the linking transaction, after `openStep`'s instance lock (`lockAndLoad`), on the grants `authorizeStepWrite` reloaded in that transaction.
  - It answers 422 `procedure_step.output_record_invalid`, with the same body as an unknown evidence id.
  - The audit is the existing `authorization.denied` failed-mutation event. There is no new event type, no new operation and no new response shape.
- **No product change by me.** `steps.ts` is exactly as in the WIP.

**What I changed:**

- **Tests.** I added the sibling-branch tests: a transformation-scope instance, in the same test file (+87 lines).
- **Checks.** I re-ran every check on the final tree, with new logs.
- **Handback.** I wrote this handback.

## Files changed (vs `acf4629`)

| File | Purpose | Author |
|---|---|---|
| `apps/api/src/modules/procedures/steps.ts` | `linkEvidence`: the evidence's own read (`transformation.read` on its transformation) before the link is written | WIP (BE-V2B), unchanged by me |
| `apps/api/test/integration/procedures/evidence-link-read-authorization.test.ts` | 4 tests: the adopted-step refusal and positive path (WIP), plus the transformation-scope refusal and positive/guard path (mine) | WIP + me |
| `docs/delivery/handbacks/DG5/T-DG5-BE-V2C-evidence/*` | Logs of this run | me |
| this handback | | me |

There are no migrations and no new API endpoints. Also untouched: the contract, `tests/qa/**`, and the files outside my ownership.

## Path closed: `POST /api/v1/procedure-instances/{instanceId}/steps/{stepKey}/evidence` (adopted step)

- **Cause.** On a step adopted into T (D-166/D-167), `linkEvidence` checked that the evidence belongs to T but not that the acting person can read T. An organization-scope actor reaches the adopted step through its organization grant (`authorizeStepWrite`). If that actor had lost read on T but still knew an evidence id, it could link T's evidence.
- **Fix.** `apps/api/src/modules/procedures/steps.ts:1428-1439` (the evidence row read at `:1428-1432`; the read check at `:1439`): `if (ev !== undefined) await requireOutputRead(tx, acting.principal, ev.transformation_id);`, before `insertLink` (`:1440`).
- **Failing before.** `T-DG5-BE-V2C-evidence/failing-before.log`, exit 1. I ran it with `steps.ts` temporarily replaced by its `acf4629` version, then restored it; it is byte-identical to HEAD afterwards.
  ```
  × … an organization-scope actor who cannot read T links T's evidence: refused like an unknown record, nothing linked
  AssertionError: expected [ 200, undefined, undefined ] to deeply equal [ 422, …(2) ]
  ```
  So the pre-fix tree **linked** the unreadable evidence (200).
- **Passing after.** On the fixed tree, `T-DG5-BE-V2C-evidence/passing-after-file.log` shows exit 0 and 4/4. The test is also inside the full assigned run, `integration-assigned.log`.
- **What the test asserts:**
  - 422 `procedure_step.output_record_invalid`, with the exact detail;
  - no evidence id or T in the body;
  - the same code, detail and keys as an unknown evidence id;
  - nothing linked, and the instance version and step unchanged;
  - the audit is exactly `[authorization.denied, transformation, T, T]`, and an unknown id writes no audit;
  - with read restored, the same request links.

## Sibling paths checked in `apps/api/src/modules/procedures/**`

The scope: anything that names a record by id and writes a link to it. The only writer of `procedure_instance_link` is `insertLink` (`steps.ts:680`; `grep insertInto("procedure_instance_link")` finds one site). `instances.ts` does not call it. Its callers, and the other id-naming writes:

| # | Path | Names a record by id? | Status | Proof |
|---|---|---|---|---|
| 1 | `linkEvidence`, **transformation-scope instance** (`steps.ts:1420-1442`) | yes (`evidenceId`) | **Closed the same way** (the same `:1439` check applies to every instance, not only adopted steps). Before the fix the response was already refused by the 0069 guard (evidence must belong to the instance's T), so there was no linking gap. The read check now answers first, audited as `authorization.denied` on the record's transformation, consistent with path 2 and BE-V2. | New tests: "evidence of a transformation the actor cannot read: refused like an unknown record, nothing linked", and "positive: the actor links evidence of its own transformation; readable evidence of another stays refused by the guard". Before the fix, only the refusal test's audit assertion failed (`expected [] to deeply equal [ [ 'authorization.denied', …(3) ] ]`, `failing-before.log`); its status, code and nothing-linked assertions already held. |
| 2 | `linkEvidence`, **adopted step** | yes | **Closed** (above) | above |
| 3 | `completeStep` → adapter `produce` (`steps.ts:1323-1340`) | yes (`outputRecordId`) | Closed by BE-V2: every adapter is built by `outputAdapter` (`outputs/kit.ts:243`), which calls `requireOutputRead` for every mode (`kit.ts:249`). `grep produce:` shows no other adapter implementation in `src`. | `output-read-authorization.test.ts` (3 tests, passing) |
| 4 | `completeStep` → generic `link` without an adapter (`steps.ts:1341-1344`) | yes | Closed by BE-V2 (`requireNamedRecordRead`, `:1344`) | `output-read-authorization.test.ts` ("generic" case) |
| 5 | `onApprovalOutcome` (`steps.ts:1451-1493`) | links the approval being decided, or an adapter's `advance` record | No gap. This is not a caller-named id: it runs in the business approver's deciding transaction (workflows, ADR-0026). `principal: null` by design (`kit.ts:121-123`). `advance` acts only on a record an earlier step linked after the read check. | Existing approval-step tests in `procedure-instances.test.ts`, passing |
| 6 | `assignStep` (`steps.ts:1386-1418`) | names a **user** (`assigneeUserId`), writes no link | Not a record link. It is checked as active, same organization, and holding the step's role in `stepRoleTarget`. | Existing tests, passing |
| 7 | `launch` `subjectRecordType`/`subjectRecordId` (`instances.ts:386-405`, stored at `:318`) | yes, instance-level | **Not a step-level link (outside this scope); observation, not changed.** It is stored as an opaque, frozen reference (0069: only the both-or-neither CHECK). The API never reads or resolves it: `steps.ts:1186` presents it back verbatim, and no adapter uses it (`grep subject_record_id`). So it discloses nothing. But it is unverified: a launcher could record the id of a record they cannot read. | none (no change). For the orchestrator to decide whether F-DG5-101's rule should cover it. |
| 8 | `updateInputs` (`instances.ts:459-480`) | input values are typed fields (ADR-0041), not record links | No link written | n/a |

## Checks (final tree; logs in `docs/delivery/handbacks/DG5/T-DG5-BE-V2C-evidence/`)

The environment for every check: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline. Empty `.claude`/`.cc-writes` directories in `apps packages tests tools` were removed before each test run; none was found.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` | 0 | PASS gate DG4 (historical) | `validate-dg4-historical.log` |
| 2 | `pnpm -r typecheck` | 0 | all packages Done | `typecheck.log` |
| 3 | `pnpm -r build` | 0 | all packages Done | `build.log` |
| 4 | `pnpm lint` (`eslint . --max-warnings=0`) | 0 | no output | `lint.log` |
| 5a | `pnpm format:check` (`prettier --check .`) | **2** | "All matched files use Prettier code style!", but `[error] Unable to read file "CLAUDE.local.md": EACCES`. That file is an untracked, sandbox-read-denied file at the tree root; it is not repository content. | `prettier.log` |
| 5b | `git ls-files -co --exclude-standard -z \| grep -zv '^CLAUDE.local.md$' \| xargs -0 npx prettier --check --ignore-unknown` (BE-V2's form, minus the unreadable file) | 0 | All matched files use Prettier code style! | `prettier-gitfiles.log` |
| 6 | `pnpm openapi:lint` | 0 | PASS, OpenAPI 3.1.1, 846 operations | `openapi-lint.log` |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE npx vitest run --configLoader runner --project unit-node` | 0 | 144 files, **2335/2335** | `unit-node-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 npx vitest run --configLoader runner --project unit-node` | 0 | 144 files, **2335/2335** | `unit-node-c-utf8.log` |
| 9 | `QA_PG_PORT=23050 MTH_PORT_POOL=23051-23099 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration apps/api/test/integration/procedures apps/api/test/integration/contract/contract.test.ts` | 0 | 10 files, **144/144** (WIP's 142 + my 2). PostgreSQL 16.13 on port 23050 (attempt 1), fresh database, 88 migrations. | `integration-assigned.log` |
| 10 | The same harness, the new test file only, pre-fix `steps.ts` (failing-before) | 1 (expected) | 2 failed, 2 passed | `failing-before.log` |
| 11 | The same harness, the new test file only, fixed tree (passing-after) | 0 | 4/4 | `passing-after-file.log` |

- **Repository-wide suites:** not run, D-164.
- **Diffs:** `product-change.diff` and `test-change.diff`, both vs `acf4629`.

**Disclosures:**

- **Load rule (D-164) not fully kept.** I issued checks 2, 3 and 4 (typecheck, build and lint) in a single tool batch, so they may have run concurrently, not "one at a time". Each exited 0. I did not re-run them, because D-164 also says "once each". Checks 5 to 11 ran strictly one after another.
- **Prettier.** 5a's exit 2 is the sandbox read denial on `CLAUDE.local.md` only. 5b is the substantive check, and it is clean.
- **Failed or flaky tests:** none, other than the intentional failing-before run.
- **Timeouts:** the first validator call hit the 120 s foreground limit and was moved to the background by the harness. It completed with exit 0; it was not a failure.

## ADR and data-dictionary statements for T-DG5-ARCH-R4

These are in addition to BE-V2's list.

- **ADR-0042 amendment, "Link evidence" (`ADR-0042-…md:285`).** It reads: "The evidence of an adopted step must belong to T (`:1421–1431`; 422 `procedure_step.output_record_invalid` otherwise)." This is now incomplete, and its line references are stale.
  - Add: for every instance (adopted or not), the acting person must hold `transformation.read` on the evidence's transformation, on grants reloaded in the linking transaction.
  - Otherwise the refusal is the same 422, audited as `authorization.denied`.
  - The code is now at `steps.ts:1420-1442`.
- **ADR-0042 §9 authorization table (`:150-151`).** "update inputs, complete/skip a step" does not list the evidence link. Linking evidence also needs read on the evidence record.
- **`docs/api/openapi.yaml:18991` (summary of the step-evidence operation).** "Link evidence of the instance's transformation to an active step…" is still true. The architect may add "that the caller can read". This is description text only; the codes and shape are unchanged.
- **Data dictionary `procedure_instance_link` (`:9896`).** It is not untrue: the database guard is unchanged. As BE-V2 noted, it could say that the API also requires the actor's read on the linked record (outputs and evidence).

## What remains

- **Item 7 (the launch `subjectRecordId`)** is an unverified, but never resolved or disclosed, record reference. I did not change it, because it is outside the step-level scope. **Orchestrator decision needed.**
- **ARCH-R4** applies the ADR and dictionary statements above.
- **Merge:** the orchestrator applies BE-V2's proposed a02 fixture hunk in `tests/qa/**` (not mine).
- **Round 2:** code-security re-verifies F-DG5-101, including this path. I do not close my own finding.

## Merge instructions

- **No migrations.** Nothing to run.
- **The changes:** the WIP commit `1773a24` plus my uncommitted test addition and evidence. They touch only `apps/api/src/modules/procedures/steps.ts` (via the WIP) and `apps/api/test/integration/procedures/evidence-link-read-authorization.test.ts`, so there should be no conflicts with FE-V1B.
- **The contract test's pinned counts:** delta 0. No operations were added or removed.
