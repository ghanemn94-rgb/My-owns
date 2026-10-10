# Handback T-DG4-QA-D (qa-verifier, authoring): REQ-PB-010 scorecard re-read and REQ-S03-004 draft-before-G2

- **Stage:** P4 / DG4 (BUILDING). **Kind:** authoring (pre-freeze acceptance tests), **not** a DG4 gate review. This run grants no gate verdict.
- **Invocation reference:** `{"kind":"claude-code-cli-session","run_id":"DG4-T-DG4-QA-D-qa-verifier-20261010T180902Z-a1e4767f","session_id":"a1e4767f-7e11-44e7-90f7-d104064edbbb"}`
- **Assignment:** `docs/delivery/assignments/DG4/T-DG4-QA-D.md` (sha256 `3b3aca2b…2008`, verified with `sha256sum` before reading it).
- **Working tree:** `/home/user/wt/dg4-qa-d`, branch `dg4/qa-d`, `HEAD` = `286f03153dd5aff87f5368bb385d645198ccebef`. I edited no tracked file (`git diff --stat` is empty).
- **Time:** start `2026-10-10T18:11:31Z`, end `2026-10-10T18:29:44Z` (about 18 minutes, well inside the 2-hour limit).
- **Independence:** I did not author any product implementation.
- **Data:** all data is synthetic. Every product gate decision (G1–G5) in the fixtures is a synthetic in-product approval by a test person on test data. It approves nothing real, and no agent granted a business, Finance or IT approval. Product gates never imply DG0–DG7.

## 1. Changed files (all new, uncommitted, for the orchestrator to integrate)

| File | Purpose |
|---|---|
| `tests/qa/integration/a01-one-source-of-truth-scorecard.test.ts` | REQ-PB-010 / A01: one rename, then re-read the T10 Portfolio area (scorecard), the traceability view, the roadmap, the benefits register and the database. |
| `tests/qa/integration/a02-a08-drafts-before-g2-scale-after-g5.test.ts` | REQ-S03-004 / A02, A08: one test covering all three parts of the clause on one native transformation. |
| `docs/delivery/test-evidence/DG4/qa/T-DG4-QA-D-authoring/**` | This handback, run logs and mutation evidence (scripts and logs). |

I did not change `tests/qa/support/**`. Both suites import the existing helpers (`api.ts`, `p4.ts`, QA-B's `gates-native.ts`), plus the backend's BE-M `seedTraceWorld` and BE-J `launchedInitiative` fixtures directly.

## 2. Suites authored and what each asserts

### 2.1 `a01-one-source-of-truth-scorecard.test.ts` (REQ-PB-010, A01): 2 tests

**Setup (disclosed fixtures):**
- the BE-M chain world (`seedTraceWorld`);
- one initiative inserted already `launched`, with its `initiative.create` audit event (BE-J `launchedInitiative`).

The fixture is needed because the T10 Portfolio area lists only `selected/funded/launched/completed` initiatives (`PORTFOLIO_INITIATIVE_STATUSES`). Selection and launch are separate business approvals, outside this clause. The rename and every read go through the real API, with responses validated against `openapi.yaml` by the harness.

1. **Baseline, before the rename.**
   - `GET /transformations/{id}/dashboard` has exactly one `portfolio` area, and exactly one item for the initiative: `["initiative", code, originalName]`.
   - `GET …/traceability` has exactly one node for it, with the same values.
   - This proves the scorecard really lists the initiative, so the later check is not vacuous.
2. **After ONE `PATCH /api/v1/initiatives/{id}`** (If-Match; returns 200, the new name and version +1):
   - **Database:** exactly one `initiative` row matches the id or the code, and its `name` is the new name. No row in this transformation still carries the old name. Exactly one new `initiative.update` audit event was written.
   - **Scorecard (T10 Portfolio area):** exactly one item for the initiative, `[recordType, code, label, href] = ["initiative", code, <DB row name>, "/api/v1/initiatives/{id}"]`. No item is labelled with the old name.
   - **Traceability view:** checked both as the full graph and rooted (`?rootType=initiative&rootId={id}`). Each has exactly one node `["initiative", code, newName]` and no node with the old name.
   - **Roadmap** shows the new name. The **benefits register** row (the benefit allocated 100 % to the initiative) has `initiatives = [{id, code, name: newName}]`.

### 2.2 `a02-a08-drafts-before-g2-scale-after-g5.test.ts` (REQ-S03-004, A02 + A08): 1 test, all three parts in order

The world is QA-B's native builder (`seedNativeGateWorld`, `passGatesNatively`): the Lead creates the transformation, roles are granted through the access API, gaps are covered by exceptions the approver accepts, the Lead submits and the approver decides.

1. **G2 not approved.**
   - In **Diagnose**: the gate view shows G2 `draft` (not `approved`), the `gate_instance` row shows `draft`, and there are 0 `gate_decision` rows for G2.
   - After a native G1 approval the transformation is in **Define** (the phase G2 closes; Design starts only after G2). The same three checks still hold.
2. **Design-phase drafts saved before G2.**
   - In Diagnose, `POST …/tom-gaps` (T03 TOM gap) returns **201**, with status `open` and version 1. The row is persisted and has 1 `tom_gap.create` audit event.
   - In Define:
     - a second T03 gap returns **201**;
     - `PATCH …/tom-canvas/{dimension}` (If-Match) with a target design returns **200**. The box stays `draft` with version +1, the DB row holds the text and status `draft`, and there is one more `tom_canvas_cell.update` audit event.
   - Afterwards, G2 is **still** not approved and the phase is still `define`: saving drafts approved nothing.
3. **Scaling refused before G5.**
   - G2–G4 are passed natively, and the transformation is in `transform`.
   - A new initiative is created through the API. G5 is not approved (0 G5 decisions).
   - `POST …/scale-transitions` returns **422**, `application/problem+json`, type `urn:mth:problem:invalid-transition`, code `gate.g5_not_approved`, and a `detail` matching `/\bG5\b/`. 0 `scale_transition` rows are written.
4. **Scaling allowed after G5.**
   - G5 is approved natively. The approver is read from the gate (`approverRoleCode`). Every missing mandatory criterion is covered, the Lead submits, and the approver approves with `scaleScope.items = [{initiative, BU a1}]`, which returns 201.
   - G5 shows `approved` in the DB.
   - The same scale transition now returns **201**. Exactly one `scale_transition` row exists, bound to that G5 decision's id, with one `scale_transition.create` audit event.

## 3. Requirement → test table

| Requirement | Acceptance clause | Test |
|---|---|---|
| REQ-PB-010 | A01: "renaming an initiative changes it in roadmap, **scorecard** and benefits register views in one update; no duplicate initiative rows" (scorecard = T10 Portfolio area, D-106 (d)); the assignment adds the traceability view | `a01-one-source-of-truth-scorecard.test.ts` › "after ONE PATCH, …" (and the baseline `it`) |
| REQ-S03-004 | A02: "a Design-phase draft can be saved before G2" | `a02-a08-drafts-before-g2-scale-after-g5.test.ts`, steps 1–2 |
| REQ-S03-004 | A08: "a scale transition before G5 approval returns 422 invalid-transition naming G5" | same test, step 3 |
| REQ-S03-004 | A08: "after approval it succeeds" | same test, step 4 |

## 4. Checks run (real exit codes)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, disposable PostgreSQL 16.13 (UTF8, C locale) through `tests/qa/support/with-pg.sh`. Ports: `QA_PG_PORT=25650`, `MTH_PORT_POOL=25651-25699`; every run bound 25650 on attempt 1. The sandbox's `node_modules` is read-only, so **every vitest run used `--configLoader runner`**. Before each full run, `df -h .` showed 7.9 GB free.

| # | Command | Exit | Result / evidence |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG3` (start, 18:11Z) | **0** | `PASS gate DG3 (historical)`. Output shown in my session; not saved to a file, because the evidence directory did not exist yet. |
| 2 | `QA_PG_PORT=25650 MTH_PORT_POOL=25651-25699 tests/qa/support/with-pg.sh pnpm vitest run --configLoader runner --project integration tests/qa/integration/a01-one-source-of-truth-scorecard.test.ts` (first draft) | 0 | 2/2 passed |
| 3 | same, `a02-a08-…test.ts` (first draft) | **1** | Test-authoring error: I read `saved.body.targetDesign`, but the contract's PATCH response is `TomCanvasCellView` (`body.cell.*`). I fixed the test and re-ran: exit 0, 1/1. |
| 4 | Full: `… with-pg.sh pnpm vitest run --configLoader runner --project integration tests/qa` (run 1) | **1** | 1 failed / 171 passed (172), 14/15 files. **Test defect in my a01 file:** the "no row still carries the old name" query was database-wide. The shared test DB holds BE-J fixture rows with the same name ("Synthetic launched initiative N", counter per module) in *other* transformations. I scoped the query to the test's transformation. Not a product defect. `qa-integration-full-run1-FAILED-test-defect.log` |
| 5 | Full (run 2) | 0 | 15/15 files, 172/172 tests. `qa-integration-full-run2.log` |
| 6 | Mutation driver (§5), on the post-fix tests | 0 | 2 baselines pass, 7/7 mutants fail, 2 restored runs pass. `mutation/summary.txt`, `mutation/*.log` |
| 7 | `pnpm exec prettier --check <my 2 files>` (first) | **1** | Two over-long expressions. I applied `prettier --write` to my two files only (line wrapping, no semantic change). `prettier-run1-FAILED.log` |
| 8 | `pnpm exec prettier --check <my 2 files>` | 0 | `prettier.log` |
| 9 | `pnpm lint` (`eslint . --max-warnings=0`, whole repo) | 0 | `lint.log` |
| 10 | `pnpm exec eslint --max-warnings=0 <my 2 files>` | 0 | `eslint-authored.log` |
| 11 | Full (final, on the prettier-formatted files) | 0 | 15/15 files, **172/172** tests, 99 s. `qa-integration-full-final.log` |
| 12 | `node tools/gates/validate.mjs --historical --stage DG3` (end, 18:29Z) | **0** | `PASS gate DG3 (historical)`. `validate-dg3-historical-end.log` |

**Counts per file (final run, #11):**

| File | Tests |
|---|---|
| `a01-one-source-of-truth-scorecard` | **2** (new) |
| `a02-a08-drafts-before-g2-scale-after-g5` | **1** (new) |
| `a03-modular-entry` | 12 |
| `a04-a05-a10-partials` | 4 |
| `a04-kpi-propagation` | 8 |
| `a05-calculation-correctness` | 17 |
| `a08-gate-controls` | 31 |
| `a09-decision-escalation` | 17 |
| `a10-benefit-integrity` | 16 |
| `a11-adoption` | 12 |
| `a11-bau-sustain` | 17 |
| `a11-value-closure` | 11 |
| `a12-cross-scope` | 14 |
| `a13-job-idempotency` | 5 |
| `a14-concurrency` | 5 |
| **Total** | **172** |

No flaky or timed-out test was observed. No e2e step was run, because the assignment's two deliverables are API-level, so the 30 s e2e timeout rule did not apply.

## 5. Mutation checks (acceptance item 3)

I made a disposable copy of the tree in `$TMPDIR/review-qa-d-mut` (no `.git`, no `trading_agent/`). The driver `mutation/run-mutants.sh` works as follows:
- before each mutant, it restores the five product files from the worktree and checks them byte-for-byte with `cmp`;
- `mutation/mutate.py` applies exactly one mutation, and refuses (exit 2) if its anchor does not match exactly once;
- it runs the relevant suite.

**No product file in the worktree was edited.** The copy was deleted afterwards.

| Mutation (what breaks) | File mutated (copy only) | Suite | Exit | Failing assertion |
|---|---|---|---|---|
| baseline (unmutated) | — | a01 / a02 | 0 / 0 | 2/2, 1/1 pass |
| `PB010-scorecard-stale-copy`: the scorecard serves a cached first-seen copy of the name | `portfolio/dashboard-facts.ts` | a01 | **1** | scorecard item `[…, label, …]` ≠ new name |
| `PB010-traceability-stale-copy`: the initiative node label comes from a cached copy | `reporting/traceability.ts` | a01 | **1** | `traceability: expected [["initiative", code, <old>]] to equal [… new]` |
| `PB010-scorecard-label-code`: the Portfolio area stops reading the canonical name | `reporting/dashboards/engine.ts` | a01 | **1** | both tests fail on the scorecard label |
| `S03004-design-draft-blocked-before-g2`: a T03 gap create is refused while G2 is not approved | `transformations/register-kit.ts` | a02 | **1** | `422 gate.g2_not_approved … expected 422 to be 201` |
| `S03004-pre-g5-wrong-code`: before G5 the refusal is `scale.outside_approved_scope` | `workflows/scale.ts` | a02 | **1** | `[type, code]` ≠ `[invalid-transition, gate.g5_not_approved]` |
| `S03004-pre-g5-detail-without-g5`: the refusal's detail no longer names G5 | `workflows/scale.ts` | a02 | **1** | `expected 'Scaling requires the Scale business a…' to match /\bG5\b/` |
| `S03004-g5-approval-ignored`: an approved G5 never enables scaling | `workflows/scale.ts` | a02 | **1** | after approval, `422 gate.g5_not_approved … expected 422 to be 201` |
| restored (unmutated again) | — | a01 / a02 | 0 / 0 | 2/2, 1/1 pass |

**Note:** the mutation run used the test files *before* the prettier reformat (#7/#8). That reformat only re-wrapped two `expect(...)` calls, with no change to any value or matcher. The final full run (#11) is on the formatted files.

## 6. Product defects found

**None.** Both clauses hold on `286f031`. The three non-zero exits above (#3, #4, #7) were defects in my own test code or formatting, each fixed and re-run as described. None reflects product behaviour.

## 7. BLOCKED / not done / notes

- **Typecheck not run on `tests/qa/**`:** `pnpm typecheck` is `pnpm -r typecheck` (per package), and no tsconfig includes `tests/qa`. The assignment's acceptance asks for lint and prettier only. This is a gap in what I checked, not a pass.
- **Disclosed fixture in the a01 suite:** the initiative reaches `launched` through the BE-J fixture insert (with its audit event), not through the selection/launch approvals. Section 2.1 explains why.
- **Delivery-record follow-ups for the orchestrator/analyst** (I did not edit any record):
  - `requirements.csv`'s REQ-PB-010 and REQ-S03-004 trace columns can now cite these two files.
  - The "Partial"/"implicit" notes from T-DG4-AN-P4A for these two clauses are addressed by these tests.
- **Top-level dotfiles:** the worktree shows untracked top-level dotfiles (`.bashrc`, `.gitconfig`, `.idea`, `.mcp.json`, …). They pre-date my run; they are the sandbox's masked mount points, and I did not create them. They are not mine to integrate.

## 8. Merge instructions

Add the two new test files under `tests/qa/integration/`. There are no migrations, no dependency changes, and no edits to shared support files, so no conflicts are expected with T-DG4-FE-R3B or the QA-A/B/C suites. The `integration` project picks them up automatically. Run them with the command in §4 #11.
