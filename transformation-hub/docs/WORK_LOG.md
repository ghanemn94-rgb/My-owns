# Work log (checkpoint)

> Resumption: read this file, then `git log --oneline -15`, then follow "Next action". See CLAUDE.md → Resumption procedure.

## Current state — 2026-09-29

- **Branch:** `claude/mobily-transformation-hub` (repository `My-owns`, project directory `transformation-hub/`).
- **Checkpoint revision:** `38f947c` (plus the status-document refresh committed right after it).
- **Phases:** P0 PASS · P1 gate open (fixes done; re-reviews and traceability disposition running) · P2 merged
  (backend + UI + e2e), reviews running · P3 backends merged, UI in progress · P5 AI backend merged · P4/P6/P7/P8 not started.
- **Verified at `38f947c`:** API integration 437/437 (50 files, own test database, demo seed through the services),
  domain 233/233, root `pnpm lint` (all packages + i18n parity, 2746 keys per language). E2E 24/24 last executed at
  `30f58a2` (`docs/test-evidence/e2e-p1-p2-run.txt`).

## Done
- P0: specification copy, 11 agent definitions, ADRs, requirements register (394 REQs, AT-01..AT-30 traced), PRD, backlog,
  governance and security design docs, glossary, DC and general templates, source register, assumptions/open questions,
  ERD + data dictionary. Gate report `docs/phases/P0-gate-report.json`.
- P1: platform (RLS context per transaction, sessions + CSRF, RBAC+ABAC, audit hash chain, outbox, job queue/worker,
  problem+json, contract check, OpenAPI), identity (demo + OIDC), portfolio, web foundation. P1 security review
  (12 findings) fixed in `ec36f7a`; P1 QA review findings QA-P1-02/04/05/06/07/08/10/12 fixed (`9992571`, `38f947c`).
- P2: governance, planning, gates, documents — backend, web screens and e2e merged.
- P3: carve-out/NewCo and readiness/TSA backends merged (`744c9d8`, `214129a`); lead follow-ups in `38f947c`
  (regulatory register Legal-only per REQ-AGR-004, readiness.changed event, new evidence targets, append-only records).
- P5: AI runtime backend merged (mock provider only; Off by default).
- DevOps: Dockerfiles, Compose, Helm, private-mode configs, backup/restore scripts, CI workflow.

## In progress (parallel agents)
- P1 traceability disposition of every P1 `must` (QA-P1-03) → `docs/phases/P1-must-disposition.md`.
- Accessibility (axe) checks in e2e + fixes (REQ-ARC-008).
- Sort allow-list (QA-P1-13) and bilingual server strings (QA-P1-14).
- P3 web screens: perimeter/transfers, NewCo/regulatory, agreements/consents; readiness/Day-1/TSA.
- Reviews: P1 security re-review; P2 domain review.

## Known failures / risks
- CI: runs 3–5 red on the web egress scan, API image build and e2e job; fixes pushed in `38f947c` — a green run is still
  to be confirmed.
- The reference image and Excel workbook are not available here (image extraction NOT performed).
- No Docker daemon here: images are built only in CI; Helm install NOT EXECUTED.
- pgvector not installed: retrieval uses PostgreSQL full-text search (ADR-0008).

## Next action
Confirm a green CI run → merge the running agents' branches (regenerate the migration if schemas changed, rerun all
tests) → P1 QA re-review → write `docs/phases/P1-gate-report.json` → P2 QA review + gate → P3 reviews + gate → P4
(finance, JV/DD/CPs) → AI UI → P6 → P7 → P8.
