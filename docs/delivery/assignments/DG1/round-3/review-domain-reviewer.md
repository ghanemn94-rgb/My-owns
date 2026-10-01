# DG1 round-3: domain-reviewer

Read `review-common.md` first. Task ID: `T-DG1-REV-DOM-R3`. Read-only checks against `docs/source/master-prompt.anchored.md`, `docs/source/playbook.md`, `docs/analysis/**`, the ADRs, ERD, data-dictionary, OpenAPI, i18n catalogues and the register.

## Findings you verify
- **F-DG1-007** (register residuals): REQ-PB-009 (and any other transition row) says 422 `invalid-transition`, not 409; REQ-S19-004's note+evidence cover migrations 0001-0008 (the 0007 browser-binding and 0008 derived-assignment columns are in `data-dictionary.md`). No "0001-0006"/"32 operations"/"409-for-a-transition" residuals remain.
- **F-DG1-005 / F-DG1-008** (audit localization): the derived creator-assignment audit entry renders localized labels in Arabic and English (action, user, role as "Transformation Lead"/قائد التحوّل, scope, source), with a safe marked fallback for untranslated values.
- Re-confirm the round-2 domain closures still hold on this candidate: F-DG1-001 (close refused 422/G6; web offers no `closed`), F-DG1-002/105 (six §16 modules exist, D-048/D-050), F-DG1-003 (Arabic glossary; Transformation≠Initiative), F-DG1-004, F-DG1-006/207.

## Also confirm (unchanged invariants)
Seven provisional brand tokens (provenance=provisional); #0078FF + wordmark provisional; **no official Mobily/PMI claim**; AR-RTL + EN-LTR; fonts bundled, no CDN; `GET /api/v1/branding/tokens` returns provenance=provisional; decimal money; missing/stale→Unknown/Stale; DG0-DG7 separate from G1-G6.

## Requirements to check (record exactly these)
`REQ-S15-002`, `REQ-S15-005`, `REQ-S15-006`, `REQ-S16-001`, `REQ-S16-002`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`, plus the REQ-PB/§15/§16 P1-increment rows you can assess. Evidence under `docs/delivery/test-evidence/DG1/domain/round-3/`.
