# Assignment T-DG5-FE-AA1: DG5 round-5 repair (frontend-ux-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5, **FIXING** after review round 5 on candidate `sha256:a18a9f05…` (D-178).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/fe-aa1`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** Two repair tasks run in parallel (D-178): T-DG5-BE-AA1 and T-DG5-FE-AA1. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains.

## The findings you repair (binding)

- **F-DG5-147** (Low; REQ-S15-009; reported by qa-verifier in `docs/delivery/reviews/DG5/round-5/qa-verifier.json`): a record title or transformation name holding an unbroken token wider than the column widens the page at 390 px, 320 px and with 200 % text, in en and ar, through page headings (h1 `.page-header__row`), the breadcrumbs and card headings (`h2.card__title`, including the P5 "Form tools: <title>" heading).
  - Read the finding in full in `docs/delivery/findings.json` and qa's probe `docs/delivery/test-evidence/DG5/qa/tests/round-5/e2e/zz-qa-dg5r5-form-tables-verify.spec.ts` (test R5-TITLE) with its logs `docs/delivery/test-evidence/DG5/qa/round-5/05-e2e-probe-r5forms-rev2-*.log`.

- **The reviewer's reproduction is your regression test.** Turn it into a product test in the candidate's test tree, keep its final assertion, and show it failing before your fix (record the failing output) and passing after it.
- **The repair is decided by D-178** in `docs/delivery/decisions.md`. Read D-178 verbatim; the scope below restates it.

## Binding scope

- **Decided (D-178):** page headings, breadcrumbs and card titles wrap long unbroken text: `overflow-wrap: anywhere` (with `min-width: 0` on flex/grid children where needed), the rule the product already uses for long values in `apps/web/src/styles/app.css`. List every other heading or title container you checked.
- Regression: turn R5-TITLE into an asserted e2e spec: per language, synthetic transformations whose name and benefit title hold a 120-character word and the 46-character token, opened on the T14 benefit page and the transformation overview at 390 × 900, 320 × 900 and 1280 × 900 with 200 % root font, asserting `scrollWidth - innerWidth <= 1`, in chromium-en and chromium-ar. Ordinary text must still render on one line where it fits (no visual regression in existing specs).

- **The shared rules:** `docs/architecture/p5-work-split.md` §2. Reviewers check every one of them: server-side authorization re-checked at commit time, validation, optimistic concurrency, one audit event per mutation, decimal arithmetic, Unknown/Stale never zero, en and ar.
- **The design:** the ADRs the code cites (ADR-0039 onward, with their dated amendments, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml` and the zod mirrors. **Do not change the contract** (no new operation, no new response shape). If you believe a contract change is needed, stop and write the need in your handback.
- **Decisions:** D-141 to D-178 in `docs/delivery/decisions.md`.
- **Acceptance texts:** the `acceptance` text of each finding's requirement row (`docs/delivery/requirements.csv`) stays binding and is retested literally in round 6.
- **User-facing text** must be true for the release it ships in (F-DG4-160), in en and ar.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.**
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run only the Vitest projects, integration paths and e2e specs your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them; report them as "not run, D-164", never as passed.
- **Ownership:** `apps/web/**`: `apps/web/src/styles/app.css`, the page header, breadcrumb and card components if needed, and the new e2e spec.
- **Concurrent owners:** T-DG5-BE-AA1 owns `apps/api/**`, `packages/shared/**` and `docs/api/openapi.yaml`. Do not edit their files.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23200–23249 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
- **Disk.** The disk allowance is shared. Do not copy the pnpm store or clone the repository; remove your own temporary databases and outputs when a run ends.
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
3. Your spec, `p5-form-tables-reflow.spec.ts`, `p5-reflow-axe.spec.ts` and `p5-forms.spec.ts` pass on the real stack, `--workers=1`, in chromium-en and chromium-ar, in both locale settings. Report the counts. Keep only your own specs' screenshots (D-162).
- `node tools/gates/validate.mjs --historical --stage DG4` exits 0 at the end.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-FE-AA1-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-FE-AA1-evidence/`. Include:
- the files changed;
- for each finding: the cause, the fix (with `file:line`), the regression test, and its failing-before and passing-after output;
- the checks, with exit codes and counts;
- any contract, schema or dependency need, for the orchestrator;
- the ADR and data-dictionary statements your fix makes untrue or incomplete (for the architect's amendment task, T-DG5-ARCH-R7, if needed);
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
