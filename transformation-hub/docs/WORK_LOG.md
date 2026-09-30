# Work log (checkpoint)

> Resumption: read this file, then `git log --oneline -15`, then follow "Next action". See CLAUDE.md → Resumption procedure.

## Current state — 2026-09-30

- **Branch:** `claude/mobily-transformation-hub` (repository `My-owns`, project directory `transformation-hub/`).
- **Checkpoint revision:** `b41fe6e` plus the QA follow-up commit on top of it (see `git log`).

### Phases

- **P0:** PASS.
- **P1:** gate PASS WITH CONDITIONS at `65b53e9` (`docs/phases/P1-gate-report.json`). The P2 reviews confirmed every P1 closure.
- **P2:** all findings of the three P2 reviews are fixed and merged.
  - Security review: PASS WITH CONDITIONS. Access-matrix §2.2 option B is in place: the strict rule, plus 4 project-level read exceptions pending Mobily data governance (AMQ-09). The governance lists apply the grant filter.
  - Domain final review (`docs/reviews/P2-domain-final-review.md`): PASS WITH CONDITIONS. DOM-P2F-01 and -03 fixed by the lead; DOM-P2F-08 and -09 fixed with the P4 decision-reuse fixes (part 2). The Low items DOM-P2F-02, -04, -05, -06, -07, -10 and DOM-P2R-06, -08 go to the P2 gate report with owners.
  - QA final re-review (`docs/reviews/P2-qa-final-review.md`): PASS WITH CONDITIONS. QA-P2F-02, QA-P2F-03 and the QA-P2-05 residual are fixed; C1 (disposition of the 23 P2 musts still Implemented) and C4 addressed; C2 goes into the P3/P4 reviews.
  - Next: the P2 gate report on a revision with a green CI run.
  - Open questions for the governance owner: Q-40, Q-43, O-1, A-50/52/53, DOM-P2R-06/08; from P4: the 30-day long-stop warning, an extension decision type, and whether a decision paper can name a closing / model version / TSA / cutover plan (subject rule `required`).
- **P3:** backends and web screens merged. DOM-P2R-05, DOM-P2F-08 and DOM-P2F-09 fixed (readiness now uses the shared decision-use registry: kinds `tsa_service`, `tsa_extension`, `cutover_plan`). Reviews not run.
- **P4:**
  - Backends and web screens merged.
  - Domain review FAIL (`docs/reviews/P4-domain-review.md`). All its High findings are fixed: part 1 (DOM-P4-02/03/04/05/09 and Lows) and part 2 (DOM-P4-01/06/07/08 on the decision-use registry). The lowered requirements are Tested again with regression evidence.
  - Security and QA reviews not run.
- **P5:** AI backend and AI PM web screens merged (mock provider labelled Simulated); reviews not run. To check in the P5 review: `ai-proposals.service.ts` `approve()` may audit and invalidate before a throw that rolls them back.
- **P6–P8:** not started.

### Verified

- **Gates deadlock fixed:** a gate command and the worker's evaluation refresh could lock the same `gate_assessment` rows in opposite orders ("deadlock detected" → 409, seen once in the full Playwright run). Every gate writer now takes the per-project advisory lock `hub_gates:<projectId>` first (module guide, "One writer of a project's gate state at a time"). Regression `apps/api/test/gates/gate-lock-order.spec.ts` reproduces the 409 without the lock and passes with it.
- **API integration suite:** 100 files, 847 passed + 2 expected fail (DOM-P2F-02/04 probes) at `b41fe6e`. Domain 424/424, contracts 100/100, `pnpm typecheck` clean.
- **CI:** run 34 fully green at `4fadf91`. Run 38 at `40fac20` was red (shellcheck and an RTL-detector false positive), fixed in `a58218b`.
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

- P3 domain review; P3+P4 security review; P3+P4 QA review (each also covers the P2 closure re-check C2 where briefed).
- P2 residuals (the 19 P2 musts assigned in the disposition "Update at the P2 gate"): governance/planning and screens/e2e.
- Then: P3 and P4 gates, P5 reviews.

## Known failures, risks and open questions

- **Access-matrix §2.2:** decided (option B). The strict rule applies, with 4 project-level read exceptions
  (`projectLevelRead`) pending Mobily data governance (AMQ-09).
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

1. Merge the P2 QA focused re-review; fix what it finds.
2. Write `docs/phases/P2-gate-report.json`.
3. P3 reviews (domain, security, QA) → P3 gate. P4 reviews → P4 gate.
4. Merge the AI UI → P5 reviews → P6 → P7 → P8.

Before every push:
- run the full API suite and `pnpm lint`;
- run the local secret scan (tree and history);
- regenerate the single migration if the schema changed;
- after gate-flow or UI changes, also run the full Playwright suite.
