# DG1 round-2: domain-reviewer

Read `review-common.md` first. Task ID: `T-DG1-REV-DOM-R2`.

## Scope: does the repaired foundation still faithfully serve the Business Transformation domain and the source?
Re-assess against `docs/source/master-prompt.anchored.md` (§16, §15, §10, §12), `docs/source/playbook.md`, `docs/analysis/**` and the ADRs.

## Findings you verify (domain-authored in round 1)
- **F-DG1-001** (close refused): confirm P1 cannot close a transformation — a status edit to `closed` is refused (422 `invalid-transition`, citing G6), nothing written; the DG (engineering) vs G (business) separation holds and no engineering path grants a G6 business approval. Check the openapi prose, the web (no `closed` option offered), and the shared transition table.
- **F-DG1-003** (Arabic glossary + Transformation/Initiative): confirm the AR terms match `docs/analysis/glossary.md` and Transformation (التحوّل) and Initiative (مبادرة) are distinct across screens; the catalogue test asserts it.
- **F-DG1-002** (register accuracy of REQ-S16-003/004) and **F-DG1-105** (six modules exist): confirm `apps/api/src/modules/{workflows,kpi,reporting}/` exist with `index.ts` + own `*.test.ts`, are in `P1_MODULES`, and `architecture.test.ts` covers them; judge D-048 (built, not reinterpreted) and D-050 (REQ-S16-004 persistence-architecture increment; A19 restore drill → DG7).
- **F-DG1-006 / F-DG1-207** (register text): confirm 33 operations, the 409-vs-422 corrections, and the honest worker-stop wording.
- **F-DG1-004 / F-DG1-005** (web UX): the created record is reachable (not a dead not-found); audit-trail labels are localized AR/EN.

## Also confirm (unchanged domain invariants)
Seven provisional brand tokens with `provenance=provisional`; `#0078FF` + wordmark clearly provisional; **no claim of official Mobily brand or PMI status**; AR-RTL + EN-LTR every user-facing string; fonts bundled, no CDN; `GET /api/v1/branding/tokens` returns the tokens with provenance=provisional. Decimal money; missing/stale → Unknown/Stale never zero/green. DG0–DG7 (engineering) stay separate from G1–G6 (business).

## Requirements to check (record exactly these in `requirements_checked`)
`REQ-S15-002`, `REQ-S15-005`, `REQ-S15-006`, `REQ-S16-001`, `REQ-S16-002`, `REQ-S16-004`, `REQ-S19-004`, `REQ-S19-006`, plus the REQ-PB/§15/§16 P1-increment rows you can assess.

## Checks
Read the ADRs, ERD, data-dictionary (incl. the new oidc_login_state / scoped_assignment columns), OpenAPI, the token source, the i18n catalogues and glossary, and the register rows. Read-only checks only; a check you cannot run is BLOCKED. Save evidence under `docs/delivery/test-evidence/DG1/domain/round-2/`. Record each finding verdict in your sidecars and your `domain-reviewer.json`.
