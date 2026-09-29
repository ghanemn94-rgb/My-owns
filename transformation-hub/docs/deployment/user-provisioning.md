# User provisioning (joiner / mover / leaver)

## How sign-in works today (implemented)

- Authentication is **OIDC only** in production. There are no passwords, default accounts or backdoor accounts (ADR-0005, spec §21). MFA is enforced by the IdP.
- A person can sign in only if an **active, non-demo `app_user`** exists for them. The login binds to the OIDC `iss` + `sub`. Optionally (`HUB_OIDC_LINK_BY_EMAIL=true`), a pre-provisioned user record is linked to its first OIDC subject by e-mail. Unprovisioned or inactive users are refused: `oidc.not_provisioned` — "Your account is not provisioned in this application".
- Demo personas (`@demo.invalid`, `is_demo`) cannot sign in through OIDC and never exist in production. The production bootstrap refuses a database containing them.
- The **first administrator** is created by the production bootstrap ([installation.md](installation.md) §5) with `platform_admin` + `portfolio_admin`. `platform_admin` manages accounts and settings but gets **no transaction-content permissions** by default (ADR-0006).
- Roles are granted in the application: organization/portfolio roles, project and workstream memberships, and partner/clean-team room grants. Every grant is audited. Separation of duties (`not_self`) applies to sensitive grants.

**Not implemented (proposals):** IdP group → role synchronisation, SCIM or just-in-time provisioning, and
back-channel logout. Until they exist, IdP groups control **who can authenticate at all** (an IdP-side assignment
of the OIDC client), and application roles are granted in the app.

## Proposed IdP groups → application roles (for Mobily IAM to confirm — MQ-02)

Group names are placeholders. Roles are the 14 proposed roles of spec §15 / `docs/security/access-matrix.md`.
Project-scoped roles are **not** derived from global groups, because a group cannot express *which* project. They
are granted per project in the application by the project's owners.

| IdP group (placeholder) | Grants | Scope | Notes |
|---|---|---|---|
| `APP-HUB-USERS` | Permission to authenticate (IdP client assignment) | — | Membership alone gives **no** data access |
| `APP-HUB-PLATFORM-ADMINS` | `platform_admin` | organization | Account and settings administration; no content access by default. Small, reviewed group |
| `APP-HUB-PORTFOLIO-ADMINS` | `portfolio_admin` | organization / portfolio | |
| `APP-HUB-AUDITORS` | `auditor` | organization | Read-only; 403 on every mutation (SEC-T-29) |
| `APP-HUB-EXTERNAL-<PARTNER>` | Authentication only, in a **separate realm/tenant** (C-32) | — | External users get only `external_partner_limited` room grants, issued in the app per room |
| (per project, in the app) | `sponsor`, `committee_chair`, `secretary_cpmo`, `project_manager`, `workstream_lead`, `contributor`, `functional_approver`, `finance_restricted`, `legal_restricted`, `clean_team` | project / workstream / room | Granted by authorised project roles, with an audited reason |

If group synchronisation is implemented later, it should: only **add** org-level roles from groups; remove them
when the group membership ends; never grant project, room or clearance attributes; and audit each change as
`actor=idp-sync`.

## Joiner

1. The line manager raises the IAM request. IAM adds the person to `APP-HUB-USERS` (and to an org-level group only if justified).
2. A `platform_admin` creates the `app_user` (e-mail, display name, clearance granted explicitly: `admin.clearance.grant`), or pre-provisions for e-mail linking.
3. The project owners grant project, workstream or room roles in the app, with a reason.
4. The user signs in through the IdP (MFA). The first login binds the OIDC subject.

## Mover

1. IAM changes group membership, where applicable.
2. The **old** project owners revoke memberships and room grants. The new owners grant new ones. History is preserved (grants are revoked, never deleted).
3. Clearance is re-assessed (down or up) with an audited reason.
4. Access caches follow `permission.changed` events: AI-derived artefacts are invalidated (ADR-0008).

## Leaver (same day)

1. IAM disables the IdP account. That stops new sign-ins.
2. A `platform_admin`:
   - disables the user in the app (CA-02). This refuses sign-in, revokes sessions and cancels the user's scheduled jobs at execution;
   - revokes sessions (CA-01) for immediate effect on any live session.
3. Project owners review pending approvals and actions owned by the leaver and reassign them. The worker re-checks authorization at execution time (AT-19), so nothing is sent on the leaver's behalf.
4. For privileged users (platform admins, clean team, legal/finance restricted), review the leaver's last 30 days of audit (IR runbook §6.2 checklist).

## Periodic access review (proposal: quarterly)

Export role assignments, memberships, room grants and external users with their last sign-in. Owners attest or
revoke. Record the evidence in the control matrix (`docs/security/control-applicability-matrix.md`).
