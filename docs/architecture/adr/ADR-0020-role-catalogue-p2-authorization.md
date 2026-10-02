# ADR-0020: Role catalogue expansion and P2 authorization (incl. the read-only auditor write-deny)

- **Status:** Accepted for P2 (DG2). Author: solution-architect (T-DG2-ARCH-01 / 01B), 2026-10-02.
- **Requirements:** REQ-S10-001 (source roles + KDS, TD, CM/SEC, AUD, system administrator; A12: "a read-only auditor can view but every write returns 403"), REQ-PB-012 (role accountabilities), REQ-S10-003 / REQ-S06-010 (admins are not approvers), REQ-S10-016 (requester ≠ approver).
- **Builds on:** ADR-0006 (scoped RBAC, one policy function, SoD trigger on `role_permission`). Physical model: migration `0018` (permission rows, role defaults, `role_accountability`). Matrix: `docs/analysis/permissions-matrix.md` §8.

## Context

P1 seeded all 14 roles but gave them only read and structural permissions. P2 introduces the first business writes and approvals. The permission catalogue must stay one source shared by:

- the database (`permission`, `role_permission`);
- `packages/shared/src/permissions.ts`;
- the OpenAPI `PermissionCode` enum.

The read-only auditor must be able to see everything in scope and change nothing.

## Decision

1. **22 P2 permissions, seeded by 0018.** The categories are `write`, `configure` and `business_approval`.
   - `kpi_target.approve` is the only new `business_approval`. With P1's `gate.decide` and `finance.validate`, these are the only approval rights in P2.
   - `decision.decide` is `write`, because it is restricted to the decision's named owner at record level (ADR-0015 §1).
   - `permissions.ts` exports `P1_PERMISSIONS`, `P2_PERMISSIONS` and `P2_ROLE_PERMISSIONS`, merged into `PERMISSIONS`/`ROLES`.
   - `packages/db/src/seed.test.ts` asserts that 0005 equals the P1 part and 0018 equals the P2 part.
   - The integration tests (`protection.test.ts`, `admin.test.ts`) compare the seeded rows with the merged catalogue.

2. **Default role → P2 permissions.** These are a configurable starting point, not a Mobily-approved policy.

| Role | P2 permissions |
|---|---|
| SP | `kpi_target.approve`, `decision.decide`, `action.update_own` (+ P1 `gate.decide`) |
| TL | `north_star.edit`, `charter.edit`, `outcome.edit`, `kpi_definition.edit`, `baseline.edit`, `diagnostic.edit`, `tom.edit`, `workshop.facilitate`, `decision.edit`, `decision.decide`, `dependency.edit`, `action.edit`, `evidence.create`, `evidence.review`, `gate.submit`, `team.assign` |
| BO | `outcome.edit`, `kpi_target.approve`, `tom.edit`, `decision.decide`, `action.update_own`, `evidence.create`, `evidence.review` (+ P1 `gate.decide`) |
| WL | `diagnostic.contribute`, `tom.contribute`, `decision.edit`, `decision.decide`, `dependency.edit`, `action.update_own`, `evidence.create` |
| FIN | `action.update_own`, `evidence.create`, `evidence.review` (+ P1 `finance.validate`: baselines and value pools) |
| TO | `charter.edit`, `diagnostic.edit`, `dependency.edit`, `action.edit`, `evidence.create`, `evidence.review`, `gate.configure`, `team.assign` |
| KDS | `outcome.edit`, `kpi_definition.edit`, `baseline.edit`, `action.update_own`, `evidence.create` |
| TD | `tom.contribute`, `dependency.edit`, `action.update_own`, `evidence.create` |
| CM, SEC | none in P2 (forums and meetings are P4); read via P1 `BASE_READ` |
| **AUD** | **none.** Read-only: `BASE_READ` + `audit.read`, `user.read`, `access.read`, inheriting downward |
| ADM_TECH, ADM_ACCESS | none in P2 |
| ADM_METHOD | `methodology.configure` (TOM-dimension labels and translations only) |

3. **Record-level rules on top of the role permission.** All of them live in the policy function's callers, through the `access` module public interface:

| Permission | Record-level rule |
|---|---|
| `*.contribute` | create, and edit only rows the caller created or owns (`owner_user_id`/`created_by`) |
| `decision.decide` | only the named decision owner (or their delegate) |
| `action.update_own` | only actions the caller owns |
| `evidence.review` | never on evidence the caller created (also a CHECK) |
| `finance.validate` / `kpi_target.approve` | never on a record the caller created (also a CHECK for the trajectory) |
| `gate.decide` | only the configured approver, never the submitter (ADR-0015) |
| `team.assign` | only at the caller's transformation, and only roles WL, KDS, TD, CM, SEC (no approval permission, no assignment rights; SP/BO/FIN/TL/TO/AUD/admin need `access.assign`) |

4. **The read-only auditor write-deny, defended at three levels:**
   - **(a) Catalogue:** AUD holds only `read`-category permissions. `seed.test.ts` asserts every AUD permission's category is `read`.
   - **(b) Policy:** every P2 mutating route declares a write permission in its route config. The P1 architecture test already requires every governed route to declare access, so AUD fails the policy check with **403**, not 404 (AUD can read the record).
   - **(c) Test:** a P2 integration test signs in as AUD and calls **every** P2 mutating operation from the OpenAPI document (generated from the contract, so a new route cannot escape), expecting 403 and no write.
5. **Accountabilities (REQ-PB-012).** `role_accountability` holds B0018 verbatim for the six source roles (`is_source_text = true`) and platform text for the implementation roles. Arabic is provisional. It is exposed by `GET /api/v1/role-accountabilities` and on each team assignment (`GET /transformations/{id}/scoped-assignments`).
6. **Team assignment path.** The register names `/api/v1/scoped-assignments`. P1 already ships the canonical scoped-assignment resource as `/api/v1/role-assignments`, which is DG1-approved and byte-stable. P2 does **not** add a second top-level resource for the same table. It adds the transformation-scoped team view `GET/POST /api/v1/transformations/{transformationId}/scoped-assignments`, which writes the same `scoped_assignment` rows under the narrower `team.assign` rule. This is recorded as a deviation from the literal register path for the orchestrator.

## Alternatives considered

- **A fixed "read-only" flag on the session instead of permissions:** rejected. One policy function (ADR-0006) must decide everything, and AUD can also hold another role in another scope.
- **Making `decision.decide` a `business_approval`:** rejected. It would make TL/WL approval-holding roles and break the DG1 F-DG1-106 derived-creator rule (a BU-scoped TL creating a transformation would get 404 on it). This was observed in the integration suite during this task before the reclassification.
- **Granting CM/SEC P2 permissions now:** rejected. Their records (forums, meetings) arrive in P4.

## Consequences

- `PermissionCode` in OpenAPI and the zod mirror (derived from `PERMISSION_CODES`) carry 38 codes. Adding response-only enum values is allowed within v1 by the contract's versioning rule.
- `apps/api/test/integration/identity.test.ts` (TO's effective permissions) lists the merged P1+P2 set.
- Any later permission is added by a new migration plus `permissions.ts` in the same change, and the seed tests catch drift.

## Verification

- **Ran in this task (output in the handback):**
  - `seed.test.ts` passes 7/7, incl. "0018 seed equals the P2 part" and the AUD read-only assertion;
  - the integration suite (`protection.test.ts`, `admin.test.ts`, `identity.test.ts`) passes against migrations 0001–0018.
- **Required in P2 (backend-workflow-engineer + qa-verifier):** the generated AUD write-deny test over every P2 mutating operation.
