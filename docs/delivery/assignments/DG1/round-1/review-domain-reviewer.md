# DG1 assignment: domain-reviewer (round 1)

Read `docs/delivery/assignments/DG1/round-1/review-common.md` first. Task ID: `T-DG1-REV-DOM-R1`.

## Your scope: does the architecture and foundation faithfully serve the Business Transformation domain and the source?
Check against `docs/source/master-prompt.anchored.md` (§16 architecture/data model, §15 visual identity/UX, §10 roles/scoping, §12 durable jobs), `docs/source/playbook.md`, `docs/analysis/**` and the ADRs.

1. **Data model fidelity (§16, REQ-S16-004/REQ-S19-004).** `docs/architecture/erd.md` + `data-dictionary.md` cover the §16 entity groups; the P1 tables (organization, business_unit, app_user, user_identity, role/permission/scoped_assignment, session, transformation, audit_event, outbox, jobs) have sensible columns, constraints, invariants; typed relational tables for core entities, validated JSON only for extensible fields (never one unvalidated blob); canonical shared records (one decision model, one dependency/RAID record, one benefit register) are reserved coherently for later stages.
2. **Operating logic preserved.** The scoped-RBAC + SoD design (§10) keeps technical admins out of business/Finance approval; the transformation record carries mode, phase, timezone (Asia/Riyadh default), currency (SAR default); decimal money/rates; missing/stale → Unknown/Stale not zero/green. Gates DG0–DG7 (engineering) stay separate from G1–G6 (business) — nothing in P1 lets an engineering path grant a business/Finance/IT approval.
3. **Module decomposition (§16, REQ-S16-001/002/003).** The modular-monolith boundaries + the separate worker reflect the domain areas (identity/access, transformations, workflows, formulas/KPI, reporting, admin). Judge D-047: is the DG1 module **architecture** (all boundaries declared + dependency-lint + P1-active modules) a faithful P1 increment, with workflows/KPI/reporting correctly deferred to P2/P4/P5?
4. **Visual identity + bilingual UX (§15, REQ-S15-002/005/006).** The seven tokens carry the listed values and provenance=provisional; `#0078FF` and the wordmark are clearly provisional; **no string or document claims official Mobily brand compliance or official PMI status**; Arabic RTL + English LTR for every user-facing string; fonts bundled, no CDN; `GET /api/v1/branding/tokens` returns the tokens with provenance=provisional (REQ-S15-002/A20).
5. **Requirements fidelity.** The 12 DG1-completing rows' register entries (status IMPLEMENTED, evidence) are accurate and grounded; no invented source requirements; the P1 increments of later-gate rows are consistent with the source; decisions D-046/D-047 do not misstate any source/operating-logic claim.
6. **Provenance honesty.** The playbook/product is a synthesis inspired by PMI/Brightline/BRM with custom extensions — never an official PMI standard or certified product.

## Checks (record each in checks_run; save evidence under `docs/delivery/test-evidence/DG1/domain/round-1/`)
Read the ADRs, ERD, data dictionary, OpenAPI, the token source, the i18n catalogues (`apps/web/src/i18n/{ar,en}`), and the register rows. Spot-check the running shell's EN/AR screenshots if present. You may run read-only checks; a check you cannot run is BLOCKED.

## Requirements to check (record exactly these in `requirements_checked`)
The source/UX/data DG1-final rows: `REQ-S15-002`, `REQ-S15-005`, `REQ-S15-006`, `REQ-S16-001`, `REQ-S16-002`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`; plus the `REQ-PB-*` and §15/§16 P1-increment rows you can assess at this stage. (code-security covers REQ-DLV-025/033/042 + REQ-S16-003 code; qa checks all 12.)
