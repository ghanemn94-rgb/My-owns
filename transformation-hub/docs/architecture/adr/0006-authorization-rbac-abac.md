# ADR-0006 — Authorization: RBAC + ABAC, deny by default

- Status: Accepted · Date: 2026-09-29
- Requirements: spec §15, §5 (roles at org/portfolio/project/workstream/room), AT-03, AT-05

## Decision
- Permission keys `<module>.<resource>.<action>`; role → permission matrix defined in `packages/domain/src/policy`
  (versioned; the active version is recorded in `role_policy`). Matrix source: `docs/security/access-matrix.md`.
- Role assignments: organization/portfolio (`org_role_assignment`), project and workstream (`project_membership`),
  partner room (`room_grant`). Clearance on the user.
- ABAC conditions evaluated server-side: classification ≤ clearance, active room grant, clean-team room, not-self
  (separation of duties), amount within delegated authority, own workstream.
- `PolicyService.assert()` is called in every command/query service method; controllers without a declared permission
  fail the startup contract check. Out-of-scope resources return 404.
- Platform administrators manage accounts and settings but get no transaction-content permissions by default.
