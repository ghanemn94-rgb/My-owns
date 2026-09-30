# Work log (checkpoint)

> Resumption: read this file, then `git log --oneline -15`, then follow "Next action". See CLAUDE.md → Resumption procedure.

## Current state — 2026-09-30

- **Branch:** `claude/mobily-transformation-hub` (repository `My-owns`, project directory `transformation-hub/`).
- **Checkpoint revision:** `e75f7fd`.

### Phases

- **P0:** PASS.
- **P1:** gate PASS WITH CONDITIONS at `65b53e9` (`docs/phases/P1-gate-report.json`). The P2 reviews confirmed every P1 closure.
- **P2:** all findings of the three P2 reviews are fixed and merged (`f8fdf01`).
  - Security review: PASS WITH CONDITIONS. Access-matrix §2.2 option B is in place: the strict rule, plus 4 project-level read exceptions pending Mobily data governance (AMQ-09). The governance lists now apply the grant filter.
  - Domain re-review (FAIL) and QA review (FAIL):
    - DOM-P2R-01/02/03/04/05/07 and QA-P2-01/03, O-1, F-03 fixed;
    - GOV-014 and GOV-015 (conflict declarations required before voting) fixed;
    - UX-005 cockpit built.
    - Shared decision-reliance / decision-use registry: `docs/architecture/module-guide.md`, "Relying on a governance decision".
  - QA-P2-04 (English remainders on P2 screens in the Arabic UI) is being fixed.
  - Next: a focused re-review of the fixes, then the P2 gate report.
  - Open questions for the governance owner: Q-40, Q-43, O-1, A-50/52/53, DOM-P2R-06/08.
- **P3:** backends and web screens merged. DOM-P2R-05 (perimeter-version decision reuse) is fixed. Reviews not run.
- **P4:**
  - Backends and web screens merged.
  - Domain review FAIL (`docs/reviews/P4-domain-review.md`, 5 High). 7 requirements were lowered to Implemented.
  - Part 1 of the fixes (DOM-P4-02/03/04/05/09 and Lows) is in progress.
  - Part 2 (DOM-P4-01/06/07/08 on the decision-use registry) comes next.
- **P5:** AI backend and AI PM web screens merged (mock provider labelled Simulated); reviews not run.
- **P6–P8:** not started.

### Verified

- **API integration suite:** 748 passed + 11 expected fail (reviewers' `it.fails` probes) at `1c6b375`.
  - The governance fix agent ran 781 passed + 8 expected fail on its branch, and the full Playwright suite passed there: 311 tests.
- **CI:** run 34 fully green at `4fadf91`. Run 38 at `40fac20` was red: shellcheck and a false positive in the RTL detector. Both are fixed in `a58218b`.
- **Lint:** root `pnpm lint` passes. Secret scan: tree and history pass.

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

- P4 fixes, part 1: DOM-P4-02 (signing after G5), -03 (Legal-only CP waivability), -04 (CP dates, lapse), -05 (DD disclosure pins the reviewed version), -09 (demo TSA issue), and the Lows.
- QA-P2-04: Arabic remainders on the P2 screens.
- Next, part 2 of the P4 fixes: DOM-P4-01/06/07/08 on the decision-use registry.
- Then: focused P2 re-reviews, P2 gate report, P3 and P4 reviews and gates, P5 reviews.

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
