# Handback T-DG2-BE3: DG2 round-1 repairs (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING), branch `claude/mobily-transformation-platform-regate`.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG2-T-DG2-BE3-backend-workflow-engineer-20261002T105230Z-64cc10ab","session_id":"64cc10ab-965e-4285-a5ef-b814e7fc47aa"}`.
- **Assignment:** `docs/delivery/assignments/DG2/round-2/T-DG2-BE3.md` (sha256 `15d59238…9663189`, verified).
- **Base:** `96f736c` at start. During the run HEAD moved to `a7b364b` through orchestrator/analyst commits that touch only the delivery records. No file of mine was affected. Nothing is committed: the orchestrator commits.
- **Pre-implementation check:** `node tools/gates/validate.mjs --historical --stage DG1` gave `PASS gate DG1 (historical)` (exit 0).
- **Approvals:** none. Product gates G1–G6 are business approvals inside the product. Every gate decision in the tests is a synthetic demo decision that approves nothing real. Nothing here reads or writes DG0–DG7.

## 1. Per-finding fix

### F-DG2-140 (High, REQ-S13-012): evidence-verify separation of duties

**Behaviour**

- `POST /evidence/{id}/review` returns **403** when the reviewer is any of these:
  - the **creator**: `evidence.reviewer_is_creator` (kept);
  - the **author of the current note text / URL / filename reference**: `evidence.reviewer_is_author`;
  - the **uploader of the current file revision**: `evidence.reviewer_is_author`.
- The check runs twice: before the body is parsed, and again on the locked row, which closes the race with a concurrent content change. Both 403s now carry a denial, so a denied-mutation `authorization.denied` audit event is written.
- **Editing or replacing another user's content is limited to own rows.** This applies to `PATCH /evidence/{id}` and `POST /evidence/{id}/content`. Allowed callers are the item's `created_by` or its named `owner_user_id` (`evidence.create`, scope `own`). The permission catalogue has no `evidence.edit` right and `permissions.ts` is frozen, so "own rows" is the rule.
- **Archive** is allowed for own rows or for an `evidence.review` holder (curation; archiving never supplies content). A WL can no longer archive someone else's item.
- **DB guard (migration 0019):**
  - New column `evidence.content_authored_by`. It is maintained **only** by trigger `evidence_review_separation`, and any value the application sends is overwritten:
    - on insert it is set to the creator;
    - it becomes `updated_by` whenever `note_body`, `url` or `current_content_id` changes, or `file_name` changes on a `file_reference` item.
  - The same trigger refuses any new or changed review whose reviewer is the creator, the content author, or the uploader of the reviewed or current revision (constraint name `evidence_review_separation`).
  - `platform/db-errors.ts` maps that constraint to **403 `evidence.reviewer_is_author`**.
  - Pre-0019 rows keep `content_authored_by = NULL`, which means "the creator". There is no backfill UPDATE, because the record guards would require a version step and an audit event per row. The existing CHECK `evidence_verified_rule` is unchanged.

**Files:** `apps/api/src/modules/evidence/routes.ts`, `apps/api/src/modules/transformations/register-kit.ts` (new optional `updateRules` / `archiveRules` on a register spec), `packages/db/migrations/0019_evidence_review_separation.sql`, `packages/db/src/schema.ts`, `apps/api/src/modules/platform/db-errors.ts` (+ `platform.test.ts`).

**Repro → now:** both probe variants (SEC-1.note and SEC-1.file) are blocked at the edit step (403), and the owner-edit variant is blocked at the review step (403). See `dg2-repairs.test.ts` › "F-DG2-140 …" (6 tests, including the DB-bypass test).

### F-DG2-142 (Medium, REQ-S10-001): evidence-link removal authz

**Behaviour:** `POST /evidence-links/{linkId}/remove` now applies the same record-level check as link creation: `requireRecordWrite` with `RECORD_WRITE_RULES` for the linked record type, against that record's creator and owner. Otherwise the caller gets **403** and an `authorization.denied` audit event. The link stays `active` at version 1.

**Files:** `apps/api/src/modules/evidence/routes.ts`. A shared helper, `recordOwnership`, is now used by both link create and link remove.

**Repro → now:** the WL removes the TL's link on a T01 row and gets 403 (was 200). The TL removes it and gets 200. See `dg2-repairs.test.ts` › "F-DG2-142 …".

### F-DG2-203 (Medium, REQ-PB-030): transformation thesis

**Behaviour (server side; the finding's owner is FE, see §4):**

- **Shared pure composer** in `@mth/shared/schemas` (`packages/shared/src/schemas/charter.ts`):
  - `composeThesis(parts, template?)` returns `{ complete, missing[], sentence }`.
  - `THESIS_SOURCE_TEMPLATE_EN` is exactly the B0037 structure: `"If we change {change}, then {outcomes} will improve, which will create {benefits}, because {because}."`
  - A blank, whitespace-only or "." part counts as missing. While a part is missing, `sentence` is `null`, so no sentence with blanks is ever shown as answered.
  - A UI passes its own translated template of the same structure (e.g. AR).
- **Charter view:** each empty part adds a `charter.thesis_incomplete` warning to `warnings[]`, with pointer `/charter/thesisChange|thesisOutcomes|thesisBenefits|thesisBecause`. The frozen contract's `CharterView` is `additionalProperties: false`, so no new response field was added.
- **Gate readiness:** G2 `g2.outcome_tree` stays **incomplete** while any thesis part is empty, or when no charter exists (`g2.outcome_tree.thesis_incomplete`, one entry per part, with its pointer). G2 submission is therefore refused (422).
  - Why G2: the thesis is the causal chain change → outcomes → benefits (B0037) that the outcome tree steers by. The seeded criterion catalogue (0011) is frozen, so I did not add a new `g2.thesis` criterion.
  - G1 `g1.initial_charter` is unchanged; its seeded description lists the specific initial fields.
  - **Proposed decision for `decisions.md`** (orchestrator): "Thesis completeness is evaluated inside G2 `g2.outcome_tree`."

**Files:** `packages/shared/src/schemas/charter.ts`, `apps/api/src/modules/transformations/charter.ts` (`thesisWarnings`), `apps/api/src/modules/workflows/criteria.ts` (`GateFacts.charter.thesisMissing`), plus tests `transformations/thesis.test.ts`, `workflows/workflows.test.ts` and `dg2-repairs.test.ts`.

### F-DG2-204 (Medium, REQ-PB-033): charter shows a superseded North Star

**Behaviour:**

- `charterView` always returns the **current** North Star.
- When the charter's stored `north_star_id` has been superseded, the view adds warning `charter.north_star_superseded` (pointer `/northStar`).
- The next charter save **re-links** the current North Star. The change is recorded in the audit diff and in the new `charter_version` snapshot, so `northStarStatement` is the refined sentence.
- Explicitly linking a superseded North Star is refused: **422 `charter.north_star_not_current`**.

**Files:** `apps/api/src/modules/transformations/charter.ts`.

**Repro → now:** the QA probe sequence now gives `GET /charter` → `northStar = {statement: "…refined…", status: "current"}` plus the stale-link warning. See `dg2-repairs.test.ts` › "REQ-PB-033 …".

### F-DG2-205 (Medium, REQ-S04-005): phase sequence integrity

**Behaviour:**

- `sequenceProblem` in `workflows/gates.ts` returns 422 `gate.out_of_sequence` in two cases:
  - the preceding gate (by ordinal) is not `approved`;
  - the transformation has not reached the gate's own phase.
- That check is applied in three places:
  - on **submit**, before criteria evaluation, with nothing written;
  - on an **`approved` decision**, with nothing written (non-approving outcomes such as `changes_requested` stay possible, so a stale pending submission can be sent back);
  - in the gate view's `canSubmit`.
- **Modular:** a predecessor whose phase lies before the entry phase is not required, so entry at a chosen phase stays valid.
- `advancePhaseOnGateApproval` (`transformations/phase.ts`) now takes `gatePhase`. It advances **exactly one step**, from the gate's own phase to the next.
  - If the transformation is behind the gate's phase, it throws 422 `gate.out_of_sequence`.
  - If the transformation is already beyond it (Modular), it changes nothing.
  - A catalogue whose next phase does not directly follow the gate's phase is a programming error (it throws), never a silent jump.

**Files:** `apps/api/src/modules/workflows/gates.ts`, `apps/api/src/modules/transformations/phase.ts`.

**Repro → now:** in End-to-End, G2 and G3 submissions before their predecessor return 422 and the gate version is unchanged. A legacy pending G3 (written as the old API did) cannot be **approved** while G2 is unapproved: 422, phase stays `diagnose`, no `gate_decision` row. A define → mobilize jump is refused. A Modular transformation with entry `design` is refused only by G3's own criteria. See `dg2-repairs.test.ts` › "F-DG2-205 …" (4 tests).

## 2. Changed files

| File | Purpose |
|---|---|
| `packages/db/migrations/0019_evidence_review_separation.sql` (new) | `evidence.content_authored_by` + trigger `evidence_review_separation` (content-author tracking, reviewer ≠ creator / author / uploader) |
| `packages/db/src/schema.ts` | Kysely type + `SCHEMA_COLUMNS` entry for `evidence.content_authored_by` |
| `apps/api/src/modules/evidence/routes.ts` | Own-rows edit/upload, archive rule, review SoD (creator / author / uploader, re-checked under lock, with denial audit), link-removal record-level authz |
| `apps/api/src/modules/transformations/register-kit.ts` | Optional `updateRules` / `archiveRules` per register (default `writeRules`, so other registers are unchanged) |
| `apps/api/src/modules/platform/db-errors.ts` | `evidence_review_separation` → 403 `evidence.reviewer_is_author` |
| `apps/api/src/modules/platform/platform.test.ts` | Unit test of that mapping |
| `packages/shared/src/schemas/charter.ts` | `THESIS_PARTS`, `THESIS_SOURCE_TEMPLATE_EN`, `composeThesis` (pure, shared with FE) |
| `apps/api/src/modules/transformations/charter.ts` | Current North Star in the view, `charter.north_star_superseded`, re-link on save, `charter.north_star_not_current`, `charter.thesis_incomplete` warnings |
| `apps/api/src/modules/transformations/phase.ts` | One-step phase advance from the gate's own phase |
| `apps/api/src/modules/workflows/gates.ts` | `sequenceProblem` on submit, approve and `canSubmit` |
| `apps/api/src/modules/workflows/criteria.ts` | `thesisMissing` fact; `g2.outcome_tree.thesis_incomplete` |
| `apps/api/src/modules/workflows/workflows.test.ts` | Fixture + unit test for the thesis criterion |
| `apps/api/src/modules/transformations/thesis.test.ts` (new) | Unit tests: B0037 sentence, incomplete flagging, AR template, warnings |
| `apps/api/test/integration/dg2-repairs.test.ts` (new) | 13 repro/regression tests for the five findings, against real PostgreSQL |
| `apps/api/test/integration/gates.test.ts` | G2-readiness test approves G1 first (now required by F-205) |
| `apps/api/test/integration/registers.test.ts` | Charter warning expectations include the thesis flag |
| `apps/api/test/integration/aud-write-deny.test.ts` | P2 operation count 127 → 128 (the contract gained `activateKpiDefinition`, D-061) |
| `apps/api/test/integration/contract/contract.test.ts` | Total operation count 160 → 161 (same reason). `p2-pending-kpi.ts` not touched |

Diff summary: 15 modified files (+420 / −62) and 3 new files (592 lines).

## 3. Checks actually run (this run, in the sandbox, offline)

| # | Command | Environment | Result |
|---|---|---|---|
| 1 | `pnpm -r typecheck` | Node v24.21.0 | exit 0 (all 7 projects `Done`) |
| 2 | `pnpm -r build` | Node v24.21.0 | exit 0 (all 7 `build: Done`) |
| 3 | `pnpm lint` | Node v24.21.0 | exit 0 (`eslint . --max-warnings=0`, no output) |
| 4 | `pnpm test` | **Node v22.22.2** (`/opt/node22/bin`) | exit 0: `Test Files 30 passed (30)`, `Tests 484 passed (484)` |
| 5 | `pnpm test` | **Node v24.21.0** | exit 0: `Test Files 30 passed (30)`, `Tests 484 passed (484)` |
| 6 | `QA_PG_PORT=55419 tests/qa/support/with-pg.sh pnpm test:integration` | Node v24.21.0, disposable PostgreSQL 16.13 | exit 0: `Test Files 28 passed (28)`, `Tests 440 passed (440)`; includes `dg2-repairs.test.ts (13 tests)`, `evidence.test.ts (6)`, `gates.test.ts (11)`, `registers.test.ts (19)`, `contract/contract.test.ts (11)`, `migrate.test.ts (7)`, `catalogue.test.ts (9)` |
| 7 | `QA_PG_PORT=55423 tests/qa/support/with-pg.sh pnpm test:integration` | **Node v22.22.2**, disposable PostgreSQL 16.13 | exit 0: `Test Files 28 passed (28)`, `Tests 440 passed (440)` |
| 8 | Migration evidence script (scratch, not in the repo) run with `with-pg.sh` (`QA_PG_PORT=55421`): `migrate()` of `packages/db/src/migrate.ts` | Node v24.21.0, PostgreSQL 16.13 | exit 0, output below |
| 9 | `prettier --check` over `git ls-files` + my 3 new files | Node v24.21.0 | exit 0: `All matched files use Prettier code style!` |
| 10 | `node tools/gates/validate.mjs --historical --stage DG1` (start and end of the run) | Node v24.21.0 | `PASS gate DG1 (historical)`, exit 0 |

Output of check 8 (0001→0019 fresh; then 0019 applied over a database populated at 0018):

```
qa disposable cluster: PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu, ...
FRESH applied 19: 0001_identity_access.sql .. 0019_evidence_review_separation.sql
UPGRADE step 1 applied 18: .. 0018_p2_access_instantiation.sql
UPGRADE step 2 applied over populated data: 0019_evidence_review_separation.sql
existing row after 0019: {"review_status":"verified","reviewed_by":"01920000-0000-7000-8000-000000000003","content_authored_by":null}
creator re-review of the legacy row refused by: evidence_review_separation
```

The populated row was a synthetic fixture, inserted with `session_replication_role = replica`.

**Not fully green:** `pnpm format:check` exits 2. Its only error is `[error] Unable to read file "CLAUDE.local.md": EACCES`, an untracked, permission-protected local file of this environment that is not part of the repository. Every matched repo file passed (`All matched files use Prettier code style!`). Check 9 is the same check, limited to repository files.

**Contract test caveat:** check 6/7 shows `contract.test.ts` green, but only because KBE's **uncommitted** working-tree changes in the shared tree already route and exercise `activateKpiDefinition` (`apps/api/test/integration/contract/kpi-exercises.ts`, `apps/api/src/modules/kpi/**`). As the assignment anticipated, without KBE's change the contract test is red on that single operation. My only contract-test change is the total count (161), which is a fact of the frozen contract.

## 4. Known gaps / not done

1. **F-DG2-203, UI part (owner: frontend-ux-engineer).** Out of my scope (`apps/web/**`). FE still has to:
   - render the composed sentence with `composeThesis` from `@mth/shared/schemas` and an AR template of the same structure;
   - fix the `define.json` `charter.thesis.pattern` texts (EN/AR) to the B0037 structure;
   - show the `charter.thesis_incomplete` warning instead of "None";
   - show `charter.north_star_superseded`;
   - add i18n strings for the new problem codes `evidence.reviewer_is_author`, `charter.north_star_not_current` and `gate.out_of_sequence`.

   The finding is fully closed only when the UI does this.
2. **Architecture docs (frozen, architect-owned).**
   - `docs/architecture/data-dictionary.md` and `erd.md` need the new column `evidence.content_authored_by` and the trigger `evidence_review_separation` (0019).
   - ADR-0018 §3 / ADR-0020 §3 should state the extended SoD rule (creator, content author, uploader) and the own-rows evidence edit rule.
   - ADR-0015 §2 should state the sequential-gate rule. I did not edit these.
3. **Contract documentation.** `openapi.yaml` was not changed. The new problem codes use existing response statuses that are already declared on these operations (403 / 422). The architect may want to name the codes in the operation descriptions.
4. **Pre-0019 reviews are not re-examined.** A verification made before 0019 through the old bypass stays `verified`. The rule applies to every review from now on, and a re-review of such a row is guarded. Cleaning up existing data would need a separate, audited data-correction decision.
5. **Archive rule change.** Archiving someone else's evidence now needs `evidence.review` (TL, BO, FIN, TO), not just `evidence.create`. This is a deliberate tightening that goes with F-140/F-142; please confirm in review.
6. **No decisions.md edit.** The proposed D-entry (thesis completeness inside `g2.outcome_tree`; evidence edit = own rows; archive = own rows or `evidence.review`) is for the orchestrator to record.

## 5. Merge instructions

- **Migration:** `0019_evidence_review_separation.sql` is the only new migration. It applies after 0018 (`mth-db migrate`), forward-only, and is proven on a fresh database and over a populated 0018 database (check 8). The next free number is 0020.
- **Ordering with KBE:** no file overlap with KBE's `kpi/**`, `kpi-exercises.ts` or `kpi/*.test.ts`. The contract count (161) assumes KBE's `activateKpiDefinition` routing is merged with or before this change. Otherwise `contract.test.ts` stays red on that op only.
- **FE:** can consume `composeThesis` / `THESIS_SOURCE_TEMPLATE_EN` from `@mth/shared/schemas` at once (exported through the existing barrel `export * from "./charter.ts"`).
- **Findings:** the orchestrator records `import-findings --fix` for F-DG2-140, F-DG2-142, F-DG2-204 and F-DG2-205. For F-DG2-203 the server side is done and the UI part above is pending (FE).
