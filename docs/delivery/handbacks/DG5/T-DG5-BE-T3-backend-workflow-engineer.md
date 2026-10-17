# Handback T-DG5-BE-T3 (backend-workflow-engineer): DG5 W20 repair, p5-work-split §J and §C.2 (D-165 Added scope)

- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-T3-backend-workflow-engineer-20261017T093125Z-6f90a7f2","session_id":"6f90a7f2-454b-4576-a27b-f1dab59c52c2"}`
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-T3.md`, sha256 `aef70b18…5ed71` (verified).
- **Base:** `457e0ca9352e77dc6a45a1131f9fe3e0a8c01592` on branch `dg5/be-t3`. The changes are left **uncommitted**.
- **Time:** start `2026-10-17T09:31:40Z` and end `2026-10-17T10:48:04Z` (`date -u`), about 77 minutes.
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` exits 0 at the start and at the end (`validate-dg4-start.log`, `validate-dg4-end.log`): "PASS gate DG4 (historical)".
- **Evidence directory:** `docs/delivery/handbacks/DG5/T-DG5-BE-T3-evidence/`. Log names below are relative to it.

## 1. Summary

| # | Added scope | Result |
|---|---|---|
| 1 | D-QA-E-1: the demo role users can do the walkthrough on a new transformation | **Done.** The QA test "step 1 'create transformation' is performed by the demo Transformation Lead in the demo business unit" passes unchanged. |
| 2 | D-165: the demo users can sign in on a dev-mode demo database | **Done.** |
| 3 | D-QA-E-2: the intake procedure completes | **BLOCKED (reopen condition), no change.** A DG2/DG4 database rule makes an approval of an organization-scope step impossible (§3.3). |
| 4 | REQ-S12-012: a slip moves the dependent forecasts | **STOPPED, as the assignment orders.** The DG4 functions do not propagate forecasts through dependencies (§3.4). Nothing was changed. |
| 5 | QA-E O-2: the baseline step's assignee | **Done** through `procedures` v2 (migration `0095`). One QA assertion (`a02-a21-complete-lifecycle.test.ts:867`) pins the old BO assignee and now fails by design (§3.5). |

## 2. Files changed

| File | Purpose |
|---|---|
| `packages/db/src/demo/data/roaming.ts` | New exports `DEMO_ACCESS_ADMIN`, `DEMO_SIGN_IN_USERS` and `DEMO_BUSINESS_UNIT_GRANTS`. The new seeded user `roaming.user.adm_access` gets an app user row and a demo IdP identity. Three business-unit grants: TL, TO and ADM_ACCESS. The dev-issuer identities are seeded only when `ctx.devIssuerBinding` is set. |
| `packages/db/src/demo/data/roaming-ids.ts` | New block `devUserIdentity: 0x004` for the dev-issuer identities. |
| `packages/db/src/demo/seed.ts` | New `DemoSeedOptions.devIssuerBinding` (default false), passed to the dataset as `DemoSeedContext.devIssuerBinding`. |
| `packages/db/src/demo/reset.ts` | `DemoResetOptions.devIssuerBinding`, passed through to the re-seed. |
| `packages/db/src/demo/guard.ts` | New pure rule `demoDevIssuerBindingAllowed({NODE_ENV, AUTH_MODE})`: true only when `AUTH_MODE === "dev"` and `NODE_ENV !== "production"`. |
| `packages/db/src/demo/cli.ts` | `DemoCliConfig.devIssuerBinding`, passed to `seed-demo` and `reset-demo`. |
| `packages/db/src/cli.ts` | The dev binding only: computes `devIssuerBinding` from `process.env` NODE_ENV/AUTH_MODE (the same rule as `seed-dev`) and passes it to `seed-demo`/`reset-demo`. Updated the usage comment. |
| `packages/db/migrations/0095_p5_procedures_v2_baseline_assignee.sql` | **New, additive.** A seeded `procedures` v2: the ten definitions and 31 steps copied from v1, with `record_baseline` → TL. Each row has its audit event. v1 is untouched. |
| `packages/db/test/integration/demo-roaming.test.ts` | The identity test now covers the nine sign-in users. New test: the business-unit grants are exactly TL, TO and ADM_ACCESS, the transformation grants are unchanged, there is no organization grant, and ADM_ACCESS holds no approval permission. |
| `packages/db/test/integration/demo-dev-binding.test.ts` | **New.** The pure rule (6 cases), plus the **real CLI** `mth-db seed-demo` in three modes: dev, production with dev, and OIDC. |
| `apps/api/test/integration/environment/demo-users-new-transformation.test.ts` | **New.** The real demo dataset and API: dev sign-in of all nine demo users, the new-transformation access rules (positive and negative), and O-2 end to end (§3.5). |
| `docs/delivery/handbacks/DG5/T-DG5-BE-T3-*` | This handback and its logs. |

Nothing in `apps/api/src/modules/procedures/**` or `portfolio/slip-events.ts` is changed. My scope 3 experiments were reverted by restoring the `HEAD` content (§3.3).

## 3. Behaviour delivered, per scope and requirement row

### 3.1 Scope 1, D-QA-E-1 (REQ-S18-004)

REQ-S18-004 acceptance: "A02: an e2e test performs all twelve walkthrough steps with the demo role users and verifies the resulting records".

**Finding that shaped the design.** The assignment expected business-unit grants to give each demo user "their roles on new transformations of that unit". That holds only for roles that inherit downward. `access/rules.ts` `grantApplies` lets a business-unit grant of a non-inheriting role (SP, BO, FIN, KDS, WL, CM, TL) apply only to business-unit-level targets, never to a transformation of the unit. The exceptions are structural permissions (`access.assign` is one) and the F-DG1-106 creator carry-over for TL. So the least-privilege set that does act on a new transformation is:

- **TL at the demo business unit:** `transformation.create`. The creator then holds TL on the new transformation through the DG1 carry-over.
- **TO at the demo business unit:** `transformation.create`. TO inherits downward, so it holds TO on every transformation of the unit.
- **A demo access administrator** `roaming.user.adm_access` with **ADM_ACCESS at the demo business unit**. ADR-0020 §5 lets only `access.assign` grant the approver roles SP, BO and FIN on a transformation, and the demo database has no other access administrator (bootstrap refuses a demo database). ADM_ACCESS is a `technical_admin` role with no business-record or approval permission.
  - It is **not** in `DEMO_USERS`: that list stays the eight role users, and the QA test pins it.
  - It is in `DEMO_SIGN_IN_USERS`.

SP, BO, FIN, KDS, WL and CM get no business-unit grant, because it would reach no transformation. On a new transformation, the TL team-assigns WL, KDS and CM natively (`team.assign`), and the access administrator assigns SP, BO and FIN natively (`POST /role-assignments`). The existing transformation-scope grants on the seeded roaming transformation are unchanged.

Tests:

- **QA (unchanged):** `a02-a21-complete-lifecycle.test.ts` › "step 1 'create transformation' is performed by the demo Transformation Lead in the demo business unit" **passes**. "every seeded demo role user signs in through the demo IdP path…" and "the seeded roaming transformation is not 'created in this demo database'…" also pass (`final-integration-qa.log`).
- **Mine:** `demo-users-new-transformation.test.ts` covers the following:
  - the TL creates the transformation (201), holds TL there, and the walkthrough's step 1 is complete for it;
  - the TO reads it (inherited) and can create one;
  - SP, BO, FIN, KDS, WL, CM and ADM_ACCESS cannot create one (403/404), and the role users cannot read the new one before assignment (404);
  - they keep their roles on the seeded transformation (200);
  - the TL staffs WL, KDS and CM (201), and is refused SP through the team view (400 `validation`; the team schema admits only non-approver roles);
  - ADM_ACCESS assigns SP, BO and FIN (201), after which all six read the transformation (200);
  - ADM_ACCESS's self-grant is refused (422 `access.self_grant`), and it reads no business record (403/404).
- **Mine:** `demo-roaming.test.ts` checks that the business-unit grants are exactly TL, TO and ADM_ACCESS, that the eight transformation grants are unchanged, that there is no organization grant, and that ADM_ACCESS has no approval permission.

**Determinism, REQ-S18-001** ("running the reset twice yields identical record counts and checksums…"). Every new row has a fixed `01995000-…` id and the synthetic clock (`ctx.at`). The reset-twice and seed-twice suites stay green:

- `demo.test.ts`: 9/9;
- `demo-roaming.test.ts` "a second seed into a fresh database gives identical record counts and checksum";
- `environment.test.ts`: 14/14.

**Pinned counts and checksums (update, with the reason).** No test pins a literal checksum or count of the real dataset; the suites compare run against run. Measured with `mth-db seed-demo` (`dataset-counts-checksums-after.log`):

| | Before (HEAD `457e0ca`) | After, any non-dev mode (two seeds, identical) | After, `AUTH_MODE=dev` |
|---|---|---|---|
| checksum | `7c35f2a56f9faec3aab00700312cee603ad574b1d991338f8685fbb5c2f4350b` (measured) | `9fb97ef62d15ec242abade17c20bdcab487593ce0f4f5f86a4d2f3828e51dcf7` | `5dcbb6d7c456f802aeba90ddf67555d4fd3e270cd4cda1e723f3a7a5b051b0ab` |
| seeded records | 412 (derived: after − 5) | 417 | 426 |
| `app_user` / `user_identity` / `scoped_assignment` | 8 / 8 / 8 (derived) | 9 / 9 / 11 | 9 / 18 / 11 |

Reasons:

- **+5 rows in every mode:** the access administrator's app user and demo IdP identity, plus the three business-unit grants.
- **+9 identities in dev mode only:** one dev-issuer identity per sign-in user (D-165).
- **Audit events (549):** these also include the 42 audit events of migration `0095`.

The "before" checksum was measured on HEAD before any edit. The "before" row counts are derived from the after counts and the five added rows; the first HEAD measurement printed only the last lines.

### 3.2 Scope 2, D-165: the dev-mode binding (REQ-S18-004's browser path)

`mth-db seed-demo` (and `reset-demo`) with `AUTH_MODE=dev`, and never with `NODE_ENV=production`, adds one `user_identity (DEV_ISSUER, roaming.user.<role>)` per demo sign-in user. These rows are registered, audited, use fixed ids and are deterministic. `POST /auth/dev-login` can then choose them. In every other mode nothing changes. There is no secret and no password, and the demo IdP identities are unchanged.

Tests:

- **Real CLI (`demo-dev-binding.test.ts`, 4 tests):**
  - dev mode creates exactly the nine dev identities, and the nine demo IdP identities are identical;
  - with `NODE_ENV=production` and `AUTH_MODE=dev`, no dev identity is created;
  - with `AUTH_MODE=oidc`, none is created, and the demo IdP identities are unchanged;
  - plus the pure rule.
- **End-to-end at API level:** `demo-users-new-transformation.test.ts` seeds with the binding and signs all nine users in through the harness's real `POST /auth/dev-login`. An unknown subject is refused with 401.

### 3.3 Scope 3, D-QA-E-2 (REQ-S06-003): BLOCKED, no change left in the tree

REQ-S06-003 acceptance: "A01;A06: the ten procedures exist after initialization and each can be launched and completed in the A02 scenario".

**What I tried, and why each attempt fails at the database:**

1. **Carry the produced transformation onto the later steps (the assignment's example).** I updated each pending step's `transformation_id` when `capture_intake` linked its output. Completing the step then failed with **500**: the P2 row guard (`0010` `p2_row_guard`, attached to `procedure_step_instance` by `0069`) makes `transformation_id` **immutable** (`procedure_step_instance_identity_immutable`). Weakening a P2 identity guard is not something a repair should do silently.
2. **Route by the instance's output link instead,** dropping the `step.transformation_id === null` early return at `steps.ts:651`. The approval request is then refused with 422 `approval.subject_unknown`. The DG4 `approval_guard` (`0031`, `p4_approval_subject_version`) requires `SELECT version FROM procedure_step_instance WHERE id = subject AND transformation_id = approval.transformation_id`. An organization-scope step has a null `transformation_id`, so **no approval of it can ever be inserted**. On top of that, routing in the fresh intake transformation would refuse with 422 `routing.role_unmapped` until a Sponsor is mapped there (DG4 `resolveParty`, "Never a fallback").

Both changes were reverted. `steps.ts` and `seeded-procedures.test.ts` were restored from `HEAD` with `git show`, because `git checkout` cannot take the index lock in this sandbox.

**Second conflict, in the QA test itself.** `a02-a21…` › "drives every instance…" decides `confirm_sponsor` as `byRole.SP`, a user who holds SP only on the lifecycle transformation, never on the transformation the intake creates. So even with a database fix, that test cannot pass unchanged under the DG4 routing rules: the decider must hold `approval.decide` there and be the mapped Sponsor.

**Options for the orchestrator** (each changes a DG2–DG5 database rule or ADR, which is D-165's reopen condition):

- (a) A narrow `0096` exception on `procedure_step_instance` that lets `transformation_id` go from NULL to T exactly once, for a pending step of an organization-scope instance whose output link names T. This amends ADR-0042 and replaces the generic P2 row guard on that table.
- (b) A `0096` `CREATE OR REPLACE` of `p4_approval_subject_version` that resolves a `procedure_step` subject through its instance's transformation output link. This amends ADR-0026.
- (c) A redesign of the intake: for example, the sponsor confirmation becomes the first step of a transformation-scope procedure launched by the intake.

With any of them, the QA test still needs the Sponsor assigned (by the access administrator) and mapped (by the TL) on the produced transformation. That is a QA-E2 change.

Current behaviour (unchanged): the intake reaches `confirm_sponsor` and waits with `nextAction.messageKey = procedures.next_action.await_approval_unrouted`. That screen is truthful.

### 3.4 Scope 4, REQ-S12-012: STOPPED, gap reported, nothing changed

REQ-S12-012 acceptance: "A13: a 5-day slip notifies each affected owner once and moves dependent forecasts per the logic".

The DG4 scheduling functions do not propagate forecast dates through dependencies:

- `portfolio/schedule.ts` `predecessorFinish` (ADR-0023 §5) reads only the initiative's own milestones (latest forecast, else approved, else planned end). Its header says "No critical-path claim and no duration model: only precedence and date comparison".
- `schedule-network.ts` `loadScheduleNetwork` → `@mth/shared/calc` `computeCriticalPath` (`cpm-fs/1`, ADR-0031 §8–§11) works on recorded **durations**, in "working-day offsets from 0". It takes no milestone date, so a predecessor's forecast slip changes none of its outputs.

So no DG4 read returns a moved dependent forecast. Per the assignment, I changed nothing in DG4 or in `slip-events.ts`. To close REQ-S12-012's "moves dependent forecasts" clause, the orchestrator needs to decide one of these:

- a date-anchored propagation over the network (an ADR-0031/ADR-0023 change; a reopen candidate);
- a reading of "per the logic" as the DG4 logic (the slip's evidence plus the recomputed critical path and `needed_by` flags).

### 3.5 Scope 5, QA-E O-2 (REQ-S06-002, REQ-PB-027)

REQ-S06-002 acceptance: "A02: a baseline-validation instance shows its current step and assignee; completing it creates a validated baseline record linked to the instance". REQ-PB-027 gives baseline create and edit to TL and KDS (`0018`).

**Migration `0095`** inserts `procedures` **v2** (`01920005-0300-7000-8000-000000000002`) with `origin = 'seed'`. ADR-0039 says seeded versions are inserted by migrations only, and a seed's hash is an opaque identity. Its fields:

- `based_on_version_id` = v1, plus a change summary;
- the ten definitions and 31 steps copied from v1;
- `baseline_validation.record_baseline.responsible_role_code` changed BO → TL, and that definition's `responsible_role_codes` changed `[BO, FIN]` → `[TL, FIN]`;
- every row audited;
- fixed, valid ids (§5, "pre-0095-id-fix").

v1 is not edited (it is published and immutable), and no applied migration is edited.

**Which transformations get the corrected definition.** A launch uses the transformation's `procedure` pin, else the newest published `procedures` version (`instances.ts` `launchDefinition`), and **no transformation is pinned to procedures at creation**. So:

- every new transformation's launches use v2;
- so do launches made from now on in any existing transformation without a `procedure` pin. This includes the seeded roaming transformation, which pins methodology, scoring defaults and forms only.

**Why existing pins are not moved.** A transformation with a `procedure` pin stays on its version: a pin moves only through an approved methodology migration (ADR-0040 §1, `transformation_config_pin_guard`), never through a publish. A **running** instance never changes version (`0069` `procedure_instance_pinned`). `seeded-procedures.test.ts`, whose transformation is pinned to v1, still shows BO, which proves the pin is kept.

Tests (`demo-users-new-transformation.test.ts` › "QA-E O-2"):

- v2 is the newest published version, based on v1; v1's `record_baseline` is still BO and v2's is TL; all other 30 steps are equal.
- A new transformation's `baseline_validation` instance shows `record_baseline` active and assigned to **TL**.
- The BO is refused with 403 `procedure_step.not_assignee`.
- TL links evidence, records the baseline natively (`POST …/baselines`) and completes the step with it.
- FIN validates it (DG2 validation; a synthetic decision) and completes `validate_baseline`.
- The instance is `completed` with the validated baseline linked.

**Conflict with an independent QA test:** `a02-a21-complete-lifecycle.test.ts:867` asserts `[status, assigneeRoleCode] = ["active", "BO"]` for a baseline-validation instance in a **new**, unpinned transformation. That is exactly the value this scope corrects, so the assertion now fails with "expected ['active','TL'] to deeply equal ['active','BO']". I may not edit `tests/qa/**`. QA-E2 (W21) should change the expected assignee to TL and let the TL complete the step, since BO is now refused as not the assignee. In the same file, "drives every instance…" completes `baseline_validation` with v2: it picks the actor by `assigneeRoleCode`.

## 4. Checks actually run (exit codes and counts)

Every heavy command ran alone (D-164). The harness ports were 23850–23870 only.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `node tools/gates/validate.mjs --historical --stage DG4` (start / end) | 0 / 0 | "PASS gate DG4 (historical)" (`validate-dg4-start.log`, `validate-dg4-end.log`) |
| 2 | `pnpm -r typecheck` | 0 | `typecheck.log` |
| 3 | `pnpm -r build` | 0 | `build.log` |
| 4 | `pnpm lint` | 0 | `lint.log` (`eslint . --max-warnings=0`) |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **123, 123, then 0** | Run 1 flagged `seed.ts` and `demo-roaming.test.ts`; run 2 flagged my two new test files. Formatted with `prettier --write`; run 3 passed (`prettier-run1-exit123.log`, `prettier-run2-exit123.log`, `prettier.log`). This handback was checked separately (§7). |
| 6 | `pnpm openapi:lint` | 0 | "PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 846 operations" |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE npx vitest run --configLoader runner --project unit-node` | 0 | 139 files, **2305 passed** (`unit-node-locale-unset.log`) |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 npx vitest run --configLoader runner --project unit-node` | 0 | 139 files, **2305 passed** (`unit-node-c-utf8.log`) |
| 9 | `QA_PG_PORT=23861 MTH_PORT_POOL=23862-23870 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration apps/api/test/integration/procedures apps/api/test/integration/environment apps/api/test/integration/contract apps/api/test/integration/methodology` | 0 | 23 files, **290 passed** (`final-integration-api.log`) |
| 10 | `… --project integration packages/db/test/integration` | 0 | 12 files, **216 passed** (`final-integration-db.log`) |
| 11 | `… --project integration tests/qa/integration/a02-a21-complete-lifecycle.test.ts tests/qa/integration/a15-demo-transformation-outputs.test.ts tests/qa/integration/a22-operational-readiness.test.ts tests/qa/integration/a06-configuration-change.test.ts` | **1** | 4 files, **53 passed, 2 failed**, both in `a02-a21` (`final-integration-qa.log`). (a) `:867`: the BO assertion of §3.5, which fails by design. (b) `:1445`, "drives every instance…": 9/10 completed; `new_transformation_intake` is unrouted, the D-QA-E-2 behaviour of §3.3, unchanged. Step 1 by the demo TL (D-QA-E-1) **passes**. A06, A15 and A22: all pass. |

Earlier runs, disclosed:

- **`a02-a21` file (scratch log, not kept):** 1 failed, 12 passed. This was the run that showed D-QA-E-1 fixed, and the 500 from my reverted carry-over attempt (§3.3 attempt 1).
- **Intake-only run of `seeded-procedures.test.ts` (scratch log, not kept):** 1 failed, with 422 `approval.subject_unknown` (§3.3 attempt 2; reverted).
- **`integration-api-contract-methodology-run1-failed.log`: exit 1**, 2 failed and 211 passed. The zod mirror rejected `0095`'s first, md5-derived ids as non-RFC UUIDs; the second failure ("operations not exercised") was a cascade of the first. I fixed the migration: literal-pattern definition ids, and version-7 and variant-8 nibbles on derived ids. Re-run: 213 passed. The final runs 9–11 use the fixed migration.
- **Files `*-pre-0095-id-fix.log`:** earlier passing runs on the first version of `0095`, kept for traceability. The final runs supersede them.

Not run, D-164: `pnpm test`, `pnpm test:integration` and the full e2e suite. They are not reported as passed. Only `unit-node` is reached; `unit-web` and `unit-formula-nocodegen` are not, because no web or formula code changed.

## 5. Operations routed (delta to my pending list)

None. This repair routes no operation and adds no endpoint. Pending lists are unchanged. The contract's pinned counts are unchanged, and `contract.test.ts` passes, 83/83 in run 9.

## 6. Contract, schema, dependency and documentation needs (for the orchestrator)

1. **D-QA-E-2 (scope 3):** a decision among options (a), (b) and (c) of §3.3. Each one changes a DG2–DG4 database rule or ADR. The QA test also needs the Sponsor set up on the produced transformation.
2. **REQ-S12-012 (scope 4):** the DG4 gap of §3.4. Either a propagating schedule model (ADR-0031/ADR-0023) or a decision on the row's reading.
3. **QA-E2 (W21):** update `a02-a21-complete-lifecycle.test.ts:867` to the TL assignee (§3.5). For the browser walkthrough, sign the demo users in with `AUTH_MODE=dev` after `seed-demo`. Staff the new transformation natively: TL team-assigns WL, KDS and CM; `roaming.user.adm_access` assigns SP, BO and FIN.
4. **In-app reset in a dev stack** (owner: `apps/worker/src/handlers/demo.ts`, not mine). The worker's `resetDemo` call does not pass `devIssuerBinding`, so an in-app reset of a dev-mode demo database drops the dev identities until `mth-db reset-demo` or `seed-demo` runs again. The one-line fix is `devIssuerBinding: demoDevIssuerBindingAllowed(process.env)`, exported from `@mth/db/demo/guard.ts`. It is not exported from the package index; I can add it on request.
5. **Documentation (frozen files):** ADR-0050 §3 "Demo users" and the data dictionary should record three facts:
   - the demo access administrator;
   - the TL, TO and ADM_ACCESS business-unit grants;
   - the D-165 dev-mode binding.

   ADR-0042 or the data dictionary should record `procedures` v2 (`0095`).
6. **Dependencies:** none.

## 7. User-facing texts

No en/ar string in `apps/web/src` is made untrue: I searched for demo IdP/sign-in, `roaming.user` and the baseline-recorder wording. The truthful-text concern is in the frozen docs listed in §6.5. The handback itself passes `npx prettier --check`.

## 8. Merge instructions

- **Migration:** `0095_p5_procedures_v2_baseline_assignee.sql` (additive). BE-C4 owns `0094`, so the numbers stay strictly increasing (`seed.test.ts` passes in `unit-node`). A fresh database now applies 86 migrations.
- **Expected conflicts:** none. My files are not in BE-C4's, KBE-D4's or FE-D3's ownership. `packages/db/src/cli.ts` changes only the dev-binding lines.
- **After merge:** expect the two `a02-a21` failures of §4 row 11 until QA-E2 (W21) and the D-QA-E-2 decision. D-QA-E-1 is closed.

## 9. What remains

- Scope 3 (D-QA-E-2): blocked on an orchestrator decision (§3.3). No partial change is left in the tree.
- Scope 4 (REQ-S12-012 "moves dependent forecasts"): stopped on the DG4 gap (§3.4).
- The QA assertion `a02-a21:867`, the worker reset line, and the documentation notes in §6.
- **Housekeeping:** an exploration PostgreSQL cluster I started in the background (port 23850, inside this run's private `$TMPDIR`) was not visible to later shells, so I could not stop it by PID. It was stopped at its background time limit after the handback was written (task notification "killed"). It held only a scratch database, and nothing depended on it.

Everything above is synthetic demonstration data. No business, Finance or IT approval was granted. Product gates G1–G6 and engineering gates DG0–DG7 stay separate.
