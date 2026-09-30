# Work log (checkpoint)

> Resumption: read this file, then `git log --oneline -15`, then follow "Next action". See CLAUDE.md → Resumption procedure.

## Current state — 2026-09-30

- **Branch:** `claude/mobily-transformation-hub` (repository `My-owns`, project directory `transformation-hub/`).
- **Checkpoint revision:** `2ac548b`.
- **Phases:**
  - P0 PASS.
  - P1: security re-review PASS with conditions (all SEC-P1R / I-R items fixed). QA re-review
    (`docs/reviews/P1-qa-rereview.md`, at `c1338f7`): PASS WITH CONDITIONS, no Critical/High.
    - Conditions closed in `2ac548b`: REQ-SRC-002, REQ-ARC-011, disposition counts, evidence corrections.
    - Open: a security reviewer confirms the gitleaks allow-list entries (review running); a CI run on the gate revision,
      where AT-07 is listed as an open P3 finding if still red.
    - Then write `docs/phases/P1-gate-report.json`.
  - P2: the domain review FAILed with 5 High findings. All High and Medium findings are fixed and merged (`3e2a29d`,
    `c1338f7`). DOM-P2-16 (Low) is open; DOM-P2-08/11 are re-phased to P6. Web follow-ups are in progress; the QA review
    is still to run.
  - P3: backends and web screens merged; reviews not run.
  - P4: finance and JV/DD backends and web screens merged (`4511cc3`); reviews not run. Finance evidence/history
    visibility fixed (`45cf17f`).
  - P5: AI backend merged (mock provider only); web UI planned.
  - P6–P8: not started.
- **Verified at `c1338f7`** (PostgreSQL 16, own test database):
  - API integration suite: 691/691 tests in 78 files.
  - Unit tests: domain 348/348, contracts 100/100.
  - Root `pnpm lint`: pass (i18n parity at 3835 keys per language, 42 server message codes; hard-coded string check).
  - `apply_status.py --check`: OK (102 entries).
  - Secret scan (gitleaks 8.30.1, local, `d508929`): tree PASS, history PASS.
- **CI:**
  - Run 16 (`4f05318`) was fully green.
  - Runs 20–24 were red only on the secret-scan job (synthetic config-test values). Fixed in `d508929`; a green run is
    still to be confirmed.
  - In run 23 (`a471265`), every other job passed, including Playwright e2e and the Compose stack.

## Done since the last checkpoint

- P1 security re-review fixes merged (`7751b98`):
  - policy conditions fail closed (I-R3);
  - role → state → separation-of-duties order;
  - JIT off;
  - CASE-based record visibility;
  - production configuration hardening;
  - S3-compatible storage adapter (SigV4, contract tests against a fake S3 server and botocore vectors).
- QA-P1-02/03/08/10/11/13/14:
  - fresh-checkout build;
  - sort allow-list with ICU collation;
  - bilingual server data (`<field>Ar` / `<field>I18n`);
  - hard-coded string check;
  - axe a11y spec in CI;
  - must-disposition of all 82 P1 musts.
- P1 closure tests (23 tests, 7 defects fixed). The worker waits for the organization instead of crash-looping.
- P2 domain-review fixes:
  - DOM-P2-01: gate approvals backed only by typed, final decisions of the authorized body.
  - DOM-P2-02/13: vote tally and quorum rules.
  - DOM-P2-03: baseline and change-request approvals checked against the in-force matrix, with structured `costImpact`.
  - DOM-P2-04/05/07/09/10/15/19/21.
  - DOM-P2-06/20: round integrity.
  - DOM-P2-12: evidence for external approvals and matrix approvals.
  - DOM-P2-17/18: cross-project dependencies and prerequisites (API).
- Lead follow-ups to the P2 fixes:
  - policy grants: `planning.deliverable.accept` for sponsor and chair; `gates.assessment.submit` for the gate-owner roles;
  - organization-bound FK and same-project triggers for the new dependency tables;
  - `record_dependency` in the activity feed;
  - the perimeter-version approval follows the G1 gate-approval rule.
- P4 backends:
  - finance: snapshots, budget, models, benefits, KPIs, reconciliations;
  - JV/DD: partners, rooms, scenarios, DD requests and findings, closings, CPs, post-close obligations.
  - Both are adapted to the fail-closed policy, with JV record visibility.
- Data dictionary and ERD regenerated (120 tables, 115 with RLS).

## In progress (parallel agents, worktree branches)

- DOM-P2-16: gate owner and reviewer enforcement, with a gate-level review step (API, kits, seeds, gates web, e2e).
- P5 AI Project Manager web screens.
- Focused security review: gitleaks allow-list entries and the finance visibility change.
- P2 web follow-ups:
  - the external-approval dialog must send `evidenceLinkId` (this dialog currently fails with 422);
  - matrix approval document and verification;
  - `costImpact` and a decision picker;
  - cross-project dependencies and prerequisites screens.

## Known failures and risks

- **For the P3 security review:**
  - A Contributor may run the readiness "checklist from template" command. The test at
    `at-09-readiness-go-no-go.spec.ts` encodes "creator = owner" (access-matrix §2.4). QA re-review observation: decide
    whether bulk instantiation should need a workstream or project-wide reach.
  - The same self-owner claim appears in the readiness, cutover, TSA, RAID, status-update and perimeter create commands.

- **Web regression until the P2 web follow-ups merge:** recording an external authority approval from the UI returns 422
  (the API now requires a verified evidence link).
- **AT-07 in the UI (F-13 in `docs/phases/P2-P4-requirement-disposition.md`, proposed High):** at `124f3d8`
  `e2e/tests/p3-carveout.spec.ts` (a) fails. Since DOM-P2-03, a change request whose cost is only text is refused
  (`change_control.amount_unquantified`), and the UI has no `costImpact` field yet. This is assigned to the P2 web
  follow-ups.
- **Open P2 items besides DOM-P2-16:**
  - DOM-P2-14 (decision-paper completeness: evidence and attachments);
  - the P2 must-gaps listed in `docs/phases/P2-P4-requirement-disposition.md` §4: GOV-012/013/015/008/009, WS-003, and
    UX-005/006/018/024, SET-013/014, PLN-002.
- **Secret-scan allow-list:** the entries extended in `d508929` need a security reviewer's confirmation (allow-list
  policy in `scripts/ops/gitleaks.toml`).
- **DOM-P2-16** (gate owner and reviewer roles enforced, gate-level review step) is not implemented. The policy
  prerequisite is granted; the design is in `docs/reviews/P2-domain-review.md`.
- **Environment limits:**
  - The reference image and Excel workbook are not available here (image extraction NOT performed).
  - There is no Docker daemon here: images are built only in CI, and Helm install is NOT EXECUTED.
  - pgvector is not installed: retrieval uses PostgreSQL full-text search (ADR-0008).

## Next action

1. Confirm a green CI run on `d508929` or later.
2. Merge the P4 UI branches and the P2 web follow-ups. Before each push: regenerate the migration if schemas changed,
   run the full API suite and `pnpm lint`, and run the local secret scan (history + tree).
3. Act on the P1 QA re-review → write `docs/phases/P1-gate-report.json`.
4. P2: DOM-P2-16, then the QA review and the P2 gate.
5. P3 reviews and gate. P4 reviews (domain, security, QA) and gate.
6. AI UI (P5 reviews) → P6 → P7 → P8.
