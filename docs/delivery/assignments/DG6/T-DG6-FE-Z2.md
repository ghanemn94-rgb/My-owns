# Assignment T-DG6-FE-Z2: DG6 round-3 repair: the unbound secret reference error, the Arabic last-error text and an ambiguous e2e label (F-DG6-222 Medium, F-DG6-221 Low, F-DG6-261 Low) (frontend-ux-engineer)


## What to change (read first)

Read the findings verbatim in `docs/delivery/reviews/DG6/round-3/domain-reviewer.findings.json` (F-DG6-221, F-DG6-222) and `docs/delivery/reviews/DG6/round-3/qa-verifier.findings.json` (F-DG6-261), with their probes under `docs/delivery/test-evidence/DG6/domain/round-3/` and `docs/delivery/test-evidence/DG6/qa/round-3/`.

1. **F-DG6-222 (Medium, REQ-S15-011).** Saving a connector whose credential reference IT has not bound (D-209) shows "Check the highlighted fields", but no field is highlighted and the screen never says the reference is not bound. The API answers 400 with the field error `validation.secret_ref_not_bound` (or `validation.secret_ref_host_not_bound`) at a pointer such as `/config/credentialRefs/api`. Map those pointers to the credential row, mark it, and show the localized text of the code in English and Arabic. Do the same on every other form that takes a SecretRef: webhook signing, SMTP, storage and the assistant, wherever the web edits them. Add web unit tests, and an e2e test with a measured budget, in both locales.
2. **F-DG6-221 (Low, REQ-S15-007).** On the operational exception page (`apps/web/src/pages/admin/operations/OperationsPages.tsx`), "Last error" shows the server's English `lastErrorMessage` on the Arabic screen. Show the localized catalogue text for `lastErrorCode`, which the Connectors page already uses. Fall back to the code itself, not to English prose, when no catalogue text exists. Test it in both locales.
3. **F-DG6-261 (Low).** In `e2e/a02-demo-users-walkthrough.spec.ts`, step 10 selects the report output through the ambiguous label "Output". When the report definitions answer late, it selects the snapshot-list filter instead, and the test hangs until its 300 s timeout. Make the locator unambiguous, and wait for the definitions before selecting, without weakening any assertion. If the label is also ambiguous for screen-reader users, fix the label in the product, in both languages. Show the spec passing repeatedly, for example 5 runs with 0 failures.

## Stage and working tree

- **Stage:** P6 "Integration and system hardening", gate DG6 (FIXING after review round 3).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg6/fe-z2`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** no other task runs at the same time. Touch only what your repair needs.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG5` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your scope:** the findings named above. The p6-work-split section that owns each touched file still applies.
- **The shared rules:** `p6-work-split.md` §2. Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0051 onward, and the DG1–DG5 ADRs they extend), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-193 to D-196 in `docs/delivery/decisions.md` (D-195 decides p6-plan Q1–Q14; D-196 decides the ARCH-01 handback questions). Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p6-pending-*.ts` list. Exercise it in your `p6-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally. A row that cites a later-stage A-test is judged on its own acceptance text (D-142).
- **User-facing text** must be true for the release it ships in (F-DG4-160): when your work ships a feature that an existing en/ar string calls planned or later, correct that string in both languages, or list it in your handback for the owner of that file.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **Migrations (D-196):** if you need one, take the next id above the highest file in `packages/db/migrations/` on your branch and say so in the handback; the orchestrator renumbers at merge if needed. Never reuse a retired id.
- **e2e budgets are measured** (F-DG5-145/146/151 class): every new spec states a budget from a loaded measurement.
- **No new dependency.** If you need one, write the need in your handback with its official documentation, support window and licence; the orchestrator decides and installs it (D-195).

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 28950–28999 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
2. `pnpm test` passes with the locale unset and with `C.UTF-8`, in every Vitest invocation it runs. Report the counts.
3. The full product e2e is **not** required here (it takes about 1.6 h per locale); the orchestrator runs it on the merged tree. Run every spec your change touches (at least the connector, operations and a02 demo specs) in `chromium-en` and `chromium-ar`, and report the counts. Use `apps/web/e2e/support/with-stack.sh` for the product specs and `e2e/support/with-demo-stack.sh` for a02.
4. `node tools/gates/validate.mjs --historical --stage DG5` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG6/T-DG6-FE-Z2-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG6/T-DG6-FE-Z2-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
