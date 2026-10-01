# DG1 round-4: domain-reviewer
Read `review-common.md` first. Task ID: `T-DG1-REV-DOM-R4`. Read-only checks against the source, ADRs, ERD, data-dictionary, OpenAPI, i18n catalogues and the register.

## Findings you verify
- **F-DG1-009** (integration determinism): re-run the integration suite you own (REQ-S19-004/006, REQ-DLV-033) **at least 3 times** on a fresh disposable PostgreSQL and confirm the same green verdict each time (the non-determinism you found in round 3 is gone).
- **F-DG1-210** (UX): after a BU-scoped Lead creates a transformation, its detail page shows Edit/Archive and the audit trail without a manual reload (the server-granted access is reflected).
- Re-confirm the round-3 domain closures still hold: F-DG1-001/002/003/004/005/006/105/007/008/207 (close refused 422/G6; six §16 modules; Arabic glossary; audit localization; register text).

## Also confirm (unchanged invariants)
Provisional brand tokens (provenance=provisional), no official Mobily/PMI claim, AR-RTL + EN-LTR, no CDN, branding endpoint provenance=provisional, decimal money, missing/stale→Unknown/Stale, DG0-DG7 separate from G1-G6.

## Requirements to check (record exactly these)
`REQ-S15-002`, `REQ-S15-005`, `REQ-S15-006`, `REQ-S16-001`, `REQ-S16-002`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`, plus REQ-PB/§15/§16 P1-increment rows. Evidence under `docs/delivery/test-evidence/DG1/domain/round-4/`.
