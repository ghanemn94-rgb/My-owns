# ADR-0006: Authorization: scoped RBAC, one policy function, SoD hooks, delegation outline

- **Status:** Proposed for DG1. **Date:** 2026-09-30. **Author:** solution-architect.
- **Requirements:** REQ-S10-001…004, REQ-S06-010, REQ-S16-030, REQ-PB-012 (increment), REQ-S20-012 (A12 increment).
- **Input:** `docs/analysis/permissions-matrix.md`. The seeded defaults are a **configurable starting point, not a Mobily-approved access policy**.

## Decision

### Model

- **Permission catalogue:** stable codes `<area>.<action>` with a category: `read | write | configure | business_approval | finance_validation`. The P1 set is in `packages/shared/src/permissions.ts` and is seeded to the `permission` table.
  - `gate.decide` and `finance.validate` exist from P1 only so the SoD constraints below are live from the first migration.
- **Roles:** the 14 codes SP, TL, BO, WL, FIN, TO (source); KDS, TD, CM, SEC, AUD (implementation); ADM_TECH, ADM_ACCESS, ADM_METHOD (technical-admin sub-profiles).
  - Each role has `kind` and `inherits_downward`; the default is true only for TO and AUD.
  - Role→permission defaults are seeded in `role_permission`.
- **Scoped assignment:** a grant is (user, role, scope_type, scope_id, effective_from, effective_to, reason), with revocation fields.
  - Scope types: organization, business_unit and transformation in P1. Portfolio, workstream, initiative, performance_area, forum and record are reserved values, rejected with 422 until their stage.
  - Governed groups (`app_group`) come in P6 and extend the principal to user or group.
  - **Grants are never inferred from job titles or IdP attributes**. IdP group → assignment mappings are explicit, IT-controlled configuration (later).

### Scope resolution

A grant at scope S applies to target T if and only if one of these holds:
- S = T;
- the role has `inherits_downward` and S is an ancestor of T in the hierarchy organization → business unit (→ parent BU chain) → transformation.

Grants never apply across siblings. An organization-level grant of a non-inheriting role (e.g. TL) applies only to organization-level actions, **not** to all transformations. Job title never implies global access (REQ-S10-002).

### The single policy function

`access.authorize(principal, permission, target)` returns `{ allowed, reason, viaAssignmentIds }`.
- It lives in `apps/api/src/modules/access/policy.ts` and is the **only** authorization decision point for routes, exports, search, evidence downloads, notification deep links and AI retrieval (later).
- A companion `access.scopeFilter(principal, permission, recordType)` returns a Kysely expression used in list and search queries, so filtering happens in SQL, never after fetching.
- The worker calls the same function with a service principal (ADR-0008).
- A Fastify `preHandler` declared on every route (`config.permission`) fails closed: an architecture test fails if any `/api/v1` route lacks a permission declaration or an explicit `public: true`.
- **Response rule:** no read permission on a specific record gives **404** (existence not disclosed). Read allowed but action denied gives **403**.
- **Caching:** effective grants are loaded once per request, never cached across requests, so revocations apply immediately.

### Technical admins are not business approvers (REQ-S10-003, REQ-S06-010)

- A DB trigger on `role_permission` **rejects** any row that links a `technical_admin` role to a permission whose category is `business_approval` or `finance_validation`.
- The same rule is checked in the API (422) when roles become configurable (P5).
- Technical admin roles hold no `transformation.read` (matrix: "technical support only"), so ADM cannot read business records by default.
- A person who is also a business approver gets that right only through a separate, audited business-role assignment.

### Separation-of-duties hooks (logic from P2)

The policy function takes an optional `context` (`{ requesterId, submittedVersion, recordOwnerId }`) so later rules can be added without changing the signature:
- requester ≠ approver;
- a delegate of the requester ≠ approver;
- stale-version rejection;
- automation never approves: a service principal cannot hold `business_approval` or `finance_validation`, and this is enforced in the policy function.

### Delegation (table in P1, logic later)

`delegation` rows are: delegator, delegate, scope (optional), record types (optional), reason (absence | other), effective window and status. Rules to implement in P2/P4:
- Delegated rights never exceed the delegator's.
- Actions record both identities (`on_behalf_of_user_id` in audit).
- Cycles (A→B→A, A→B→C→A) are rejected.
- Delegating to the requester of a pending item is rejected.
- Expiry is automatic, by an idempotent job.

## Alternatives

- **An external policy engine (OPA, Cedar, Casbin).** Another runtime or DSL for IT to operate. The rules are relational (scope ancestry), so SQL filtering in-process is simpler and faster. We may revisit this if Mobily needs ABAC across systems.
- **Row-level security in PostgreSQL.** Attractive as defence in depth, but it needs per-request DB roles or session variables and complicates the worker and pooling. Deferred as a P6 hardening option; the application policy function is authoritative.

## Consequences

- Every list endpoint must use `scopeFilter`. A12 cross-scope tests (QA) exercise read and write outside scope.
- Role and permission defaults are data, so later configuration changes need no code change. The seed is compared with `permissions.ts` by a unit test.

## Verification evidence

This is a design decision with no third-party dependency. Tests: T-DG1-BE unit tests of scope resolution, integration tests of 404/403, the SoD trigger test, and QA's A12 first cases.
