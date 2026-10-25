# Assignment T-DG5-FE-X1: DG5 round-1 repair (frontend-ux-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5, **FIXING** after review round 2 on candidate `sha256:c4f70a80…` (D-172).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/fe-x1`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Three repair tasks run at the same time (D-172): T-DG5-BE-X1, T-DG5-BE-X2 and T-DG5-FE-X1, each in its own worktree, at the round-2 candidate's tree plus the round-2 records. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains.

## The findings you repair (binding)

- **F-DG5-142** (Medium; REQ-S15-012; reported by qa-verifier in `docs/delivery/reviews/DG5/round-2/qa-verifier.json`): D-171 observation (f) does not hold on the DG5 demo dataset: four DG2-DG3 screens (transformation overview, charter, readiness, benefit formula) keep bare, non-focusable .table-wrap scroll containers, and axe reports the serious violation 'scrollable-region-focusable' at 390 px in en and ar.
  - Read the finding in full in `docs/delivery/findings.json` (reproduction, expected, actual) and its evidence: `docs/delivery/test-evidence/DG5/qa/tests/round-2/e2e/zz-qa-dg5r2-regions-keyboard.spec.ts`, `docs/delivery/test-evidence/DG5/qa/round-2/shots/probe-r2regions-unset/en/p2-dg24.json`, `docs/delivery/test-evidence/DG5/qa/round-2/shots/probe-r2regions-unset/ar/p2-dg24.json`, `docs/delivery/test-evidence/DG5/qa/round-2/shots/probe-r2regions-cutf8/en/p2-dg24.json`, `docs/delivery/test-evidence/DG5/qa/round-2/shots/probe-r2regions-cutf8/ar/p2-dg24.json`, `docs/delivery/test-evidence/DG5/qa/round-2/shots/probe-r2regions-unset/en/r2-dg24-390_transformations_T_charter.png`.
- **F-DG5-143** (Low; REQ-S05-001; reported by qa-verifier in `docs/delivery/reviews/DG5/round-2/qa-verifier.json`): The product e2e 'T01: form tools on a diagnostic record' (apps/web/e2e/p5-forms.spec.ts:211) is order-dependent: its fixture fills the API's first diagnostic item (ordered by id, a UUIDv7 that is not monotonic within one millisecond) but the test opens the form tools of the screen's first row (ordered by dimension ordinal); it failed in 2 of 4 executions on this candidate.
  - Read the finding in full in `docs/delivery/findings.json` (reproduction, expected, actual) and its evidence: `docs/delivery/test-evidence/DG5/qa/round-2/05-e2e-product-unset.log`, `docs/delivery/test-evidence/DG5/qa/round-2/05-e2e-product2-cutf8.log`, `docs/delivery/test-evidence/DG5/qa/round-2/05-e2e-product-rerun-unset.log`, `docs/delivery/test-evidence/DG5/qa/round-2/05-e2e-product-rerun-cutf8.log`, `docs/delivery/test-evidence/DG5/qa/round-2/failure-context/product-unset/apps-web-e2e-p5-forms-T01--bc774-port-the-auditor-reads-only-chromium-ar-test-failed-1.png`, `docs/delivery/test-evidence/DG5/qa/round-2/failure-context/product2-cutf8/apps-web-e2e-p5-forms-T01--bc774-port-the-auditor-reads-only-chromium-en-test-failed-1.png`.

- **The reviewer's reproduction is your regression test.** Turn it into a product test in the candidate's test tree, keep its final assertion, and show it failing before your fix (record the failing output) and passing after it.
- **The repair is decided by D-172** in `docs/delivery/decisions.md`. Read D-172 verbatim (and D-170, D-171 for the round-1 repairs it builds on); the scope below restates it.

## Binding scope

- **Decided (D-172):**
  - **F-DG5-142: every scrolling table region on the non-P5 screens is keyboard-reachable.**
    - The qa probe found serious axe `scrollable-region-focusable` violations at 390 px, in en and ar, on demo data, on these bare `.table-wrap`s:
      - `TransformationDetailPage` (the overview);
      - `CharterPage` (`#charter-scope`, `#charter-versions`);
      - `ReadinessPage` (`#diagnostic`);
      - `BenefitFormulaPage` (`#versions`, `#calculations`).
    - It also found five more bare wrappers that scroll but contain links: on the gates G1/G4 criteria tables and others.
    - Give each of these, and every other bare scrolling wrapper on a non-P5 screen, the focusable, named region that FE-V1 introduced for the shared tables (`tabIndex=0`, `role="region"`, a localized accessible name). Use the shared component or helper, not per-page markup, where the page can use it.
    - Read the qa probe for the list (`docs/delivery/test-evidence/DG5/qa/tests/round-2/`; read it, do not import it).
  - **The regression spec.** Extend `apps/web/e2e/p5-reflow-axe.spec.ts`, or add one spec, to visit these screens on demo data (`e2e/support/with-demo-stack.sh`, or production data that makes the tables overflow) at 390 px, in chromium-en and chromium-ar. It asserts 0 serious or critical axe violations and names each failing screen.
  - **F-DG5-143: the `p5-forms.spec.ts:211` 'T01: form tools on a diagnostic record' test is order-independent.**
    - Its fixture fills the API's first diagnostic item, which is ordered by a UUIDv7 id that is not monotonic within one millisecond. The test then opens the form tools of the screen's first row, which is ordered by dimension ordinal.
    - Make the fixture fill the record of the row the test opens (by dimension), or make the test open the row of the record it filled. Do not change what it asserts.
    - Prove it is deterministic: run the spec repeatedly (at least 10 times in each locale setting, `--repeat-each`) and report the counts.

- **The shared rules:** `docs/architecture/p5-work-split.md` §2. Reviewers check every one of them: server-side authorization re-checked at commit time, validation, optimistic concurrency, one audit event per mutation, decimal arithmetic, Unknown/Stale never zero, en and ar.
- **The design:** the ADRs the code cites (ADR-0039 onward, with their dated amendments, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml` and the zod mirrors. **Do not change the contract** (no new operation, no new response shape). If you believe a contract change is needed, stop and write the need in your handback.
- **Decisions:** D-141 to D-172 in `docs/delivery/decisions.md`.
- **Acceptance texts:** the `acceptance` text of each finding's requirement row (`docs/delivery/requirements.csv`) stays binding and is retested literally in round 2.
- **User-facing text** must be true for the release it ships in (F-DG4-160), in en and ar.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.**
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run only the Vitest projects, integration paths and e2e specs your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them; report them as "not run, D-164", never as passed.
- **Ownership:** `apps/web/**`: the four screens and any other non-P5 screen with a bare scrolling `.table-wrap`, the shared table-region component, `apps/web/e2e/p5-reflow-axe.spec.ts` or a new spec, and `apps/web/e2e/p5-forms.spec.ts`.
- **Concurrent owners:** T-DG5-BE-X1 edits `apps/api/src/modules/workflows/**` and two label entries in `apps/web/src/i18n/{en,ar}/gates.json` (do not edit those two entries); T-DG5-BE-X2 edits `packages/db/src/demo/**`. Do not edit their files.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23100–23149 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
- **Disk.** The disk allowance is shared with three other tasks. Do not copy the pnpm store or clone the repository; remove your own temporary databases and outputs when a run ends.
- **Before tests:** remove any empty `.claude/.cc-writes` directories inside source folders.
- **Tests:** deterministic under load (F-DG4-143 to F-DG4-148); never read whole delivery folders (D-138); never stop processes with `pkill -f` or `pgrep -f`.
- **The write guard forbids editing:**
  - `tools/gates/**`, `tools/agents/**` and `.claude/**`;
  - `docs/source/**`;
  - review and gate records, `stages.json` and `findings.json`;
  - `trading_agent/`.

## Acceptance (real output in the handback)

1. These all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
   - `pnpm openapi:lint`
2. The `unit-web` Vitest project passes with the locale unset and with `C.UTF-8`, one at a time. Report the counts.
3. Your new or extended spec, `apps/web/e2e/p5-forms.spec.ts` (with `--repeat-each=10`) and `apps/web/e2e/p5-reflow-axe.spec.ts` pass on the real stack, `--workers=1`, in chromium-en and chromium-ar, in both locale settings. Report the counts. Keep only your own specs' screenshots (D-162).
- `node tools/gates/validate.mjs --historical --stage DG4` exits 0 at the end.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-FE-X1-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-FE-X1-evidence/`. Include:
- the files changed;
- for each finding: the cause, the fix (with `file:line`), the regression test, and its failing-before and passing-after output;
- the checks, with exit codes and counts;
- any contract, schema or dependency need, for the orchestrator;
- the ADR and data-dictionary statements your fix makes untrue or incomplete (for the architect's amendment task, T-DG5-ARCH-R5);
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
