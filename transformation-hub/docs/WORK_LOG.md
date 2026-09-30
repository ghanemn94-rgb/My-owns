# Work log (checkpoint)

> Resumption: read this file, then `git log --oneline -15`, then follow "Next action". See CLAUDE.md → Resumption procedure.

## Current state — 2026-09-30

- **Branch:** `claude/mobily-transformation-hub` (repository `My-owns`, project directory `transformation-hub/`).
- **Checkpoint revision:** `1b30f48`.

### Phases

- **P0:** PASS.
- **P1:** gate PASS WITH CONDITIONS at `65b53e9` (`docs/phases/P1-gate-report.json`).
  - CI run 32 was fully green on that revision.
  - Both independent reviews passed with conditions.
  - The P2 gate reviews must re-verify the lead's closures.
- **P2:**
  - All domain-review findings are fixed and merged, including DOM-P2-16 (gate owner and reviewer roles, gate-level review step).
  - The web follow-ups are merged.
  - DOM-P2-14 (Low) is open. DOM-P2-08 and DOM-P2-11 are re-phased to P6.
  - The gate reviews are running: domain re-review, QA review and security review.
- **P3:** backends and web screens merged; reviews not run.
- **P4:** finance and JV/DD backends and web screens merged; reviews not run.
- **P5:** AI backend merged (mock provider only); the web screens are being built.
- **P6–P8:** not started.

### Verified

- **API integration suite:** 709/709 in 80 files at the DOM-P2-16 merge (own test database, PostgreSQL 16).
- **Playwright, full suite:** 261/261 at `ef8ea27` plus the JV fixture fix. The stack was set up like the CI e2e job, and the a11y report was regenerated from that run. DOM-P2-16 changed the gate flow afterwards: only its gate-related specs were run after the merge, and CI will run the full suite.
- **Lint:** root `pnpm lint` passes. This includes i18n parity, the hard-coded string check and the module-boundary check.
- **Secret scan:** gitleaks tree and history pass.
- **Evidence file:** `apply_status.py --check` passes.

## Done in this session (highlights)

- **P1 closures:**
  - REQ-SRC-002: template source map check.
  - REQ-ARC-011: module-boundary check in the API lint.
  - Evidence corrections.
  - Must-disposition update (register counts 58/22/2).
  - Secret-scan allow-list hardening: SEC-P1S-01/02/03/07. Every path-scoped entry now names its `targetRules`, and a `.gitleaksignore` file is refused.
- **Finance visibility:**
  - Evidence and history follow the finance-domain clearance and reach.
  - Finance detail counters count only readable evidence (SEC-P1S-04).
- **Policy grants:**
  - `planning.deliverable.accept` for the sponsor and the committee chair.
  - `gates.assessment.submit` for the gate-owner roles, with the own-workstream condition (DOM-P2-16).
- **DOM-P2-17/18:**
  - Guards: an organization-bound FK and same-project triggers.
  - `record_dependency` added to the activity feed.
  - The perimeter-version approval now follows the G1 gate-approval rule.
- **Requirements:**
  - P2/P3/P4 disposition in `docs/phases/P2-P4-requirement-disposition.md`.
  - Data dictionary and ERD regenerated (120 tables).

## In progress (parallel agents, worktree branches)

- P2 domain re-review → `docs/reviews/P2-domain-rereview.md`.
- P2 QA review, which also re-verifies the P1 QA closures → `docs/reviews/P2-qa-review.md`.
- P2 security review, which also re-verifies the P1 security closures and decides on access-matrix §2.2 →
  `docs/reviews/P2-security-review.md`.
- P5 AI Project Manager web screens.

## Known failures, risks and open questions

- **Access-matrix §2.2 vs the implementation.**
  - The document says workstream-scoped read permissions also cover project-level records. The code implements the
    stricter rule, and the finance tests depend on it.
  - As a result, a workstream-only lead gets 403 on the gates list. The demo leads also hold a project-level role, so
    the demo is not affected.
  - The P2 security review will recommend a direction.
- **For the P3 security review:**
  - A Contributor can run the readiness "checklist from template" command (creator = owner, access-matrix §2.4).
  - The same self-owner claim appears in the readiness, cutover, TSA, RAID, status-update and perimeter create commands.
- **Open P2 gaps** listed in `docs/phases/P2-P4-requirement-disposition.md` §4:
  - DOM-P2-14;
  - GOV-012, GOV-013, GOV-015, GOV-008, GOV-009;
  - WS-003;
  - UX-005, UX-006, UX-018, UX-024;
  - SET-013, SET-014;
  - PLN-002.
  The domain re-review will say which of them block the P2 gate.
- **Low findings carried** in `docs/phases/P1-gate-report.json`: QA-P1-09, QA-P1R-04/05, SEC-P1S-05/06/08.
- **Environment limits:**
  - The reference image and Excel workbook are not available (image extraction NOT performed).
  - There is no Docker daemon here: images, Compose and Helm are validated only in CI, and Helm install is NOT EXECUTED.
  - pgvector is not installed: retrieval uses PostgreSQL full-text search (ADR-0008).

## Next action

1. Act on the three P2 reviews: fix, then re-review if needed.
2. Write `docs/phases/P2-gate-report.json`.
3. P3 reviews (domain, security, QA) → P3 gate. P4 reviews → P4 gate.
4. Merge the AI UI → P5 reviews → P6 → P7 → P8.

Before every push:
- run the full API suite and `pnpm lint`;
- run the local secret scan (tree and history);
- regenerate the single migration if the schema changed;
- after gate-flow or UI changes, also run the full Playwright suite.
