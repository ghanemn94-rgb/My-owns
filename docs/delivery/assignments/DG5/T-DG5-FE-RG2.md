# Assignment T-DG5-FE-RG2: DG5 round-5 repair (frontend-ux-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5, **FIXING** after clean re-gate review round 2 on candidate `sha256:5df44203…` (D-184 to D-187).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg5/fe-rg2`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** This is the only repair task (D-187). Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains.

## The findings you repair (binding)

- **F-DG5-143 (Medium)** and **F-DG5-144 (Low)** — read both in full in `docs/delivery/findings.json` and qa's round-2 record and evidence (`docs/delivery/reviews/DG5/round-2/qa-verifier.json`, `docs/delivery/test-evidence/DG5/qa/round-2/`).
- **The repairs are decided by D-187** in `docs/delivery/decisions.md`. Read D-187 verbatim.

## Binding scope

- **F-DG5-143:** `apps/web/e2e/p3-prioritization-roadmap.spec.ts` test `:542` (the read-only auditor) fails in chromium-ar because its "no enabled approve control" check matches the new slips-table sort header «الاعتمادية». Keep the test's intent (no enabled approve/move write control for AUD on the three screens) and stop it matching read-only sort controls: exclude `th` sort buttons or match the exact catalogue labels/whole words. Do not change the product's Arabic labels unless you show a collision elsewhere. Search the other e2e specs for the same substring-matching pattern on «اعتماد» or similar short Arabic verbs and fix any that the RG1 additions can trip.
- **F-DG5-144:** make `apps/web/e2e/p4-raid-governance.spec.ts` test 5 (meeting workspace) robust under full-suite load as you did for F-DG5-141 (measured reason in the handback; no weakened assertion).

- **The shared rules:** `docs/architecture/p5-work-split.md` §2. Reviewers check every one of them: server-side authorization re-checked at commit time, validation, optimistic concurrency, one audit event per mutation, decimal arithmetic, Unknown/Stale never zero, en and ar.
- **The design:** the ADRs the code cites (ADR-0039 onward, with their dated amendments, and the DG1–DG4 ADRs they extend), `docs/api/openapi.yaml` and the zod mirrors. **Do not change the contract** (no new operation, no new response shape). If you believe a contract change is needed, stop and write the need in your handback.
- **Decisions:** D-141 to D-187 in `docs/delivery/decisions.md`.
- **Acceptance texts:** the `acceptance` text of each finding's requirement row (`docs/delivery/requirements.csv`) stays binding and is retested literally in round 3.
- **User-facing text** must be true for the release it ships in (F-DG4-160), in en and ar.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **No new dependency.**
- **Load rule (D-164).** Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time. Then run only the Vitest projects, integration paths and e2e specs your change reaches, never two heavy runs in parallel. The repository-wide `pnpm test`, `pnpm test:integration` and the full e2e suite run once on the merged tree in the orchestrator's verification. Do not run them; report them as "not run, D-164", never as passed.
- **Ownership:** `apps/web/**` (screens, components, i18n, their tests, `apps/web/e2e/**`).
- **Concurrent owners:** None.

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

1. These all exit 0: `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`, `pnpm openapi:lint`.
2. The `unit-web` Vitest project passes with the locale unset and with `C.UTF-8`, one at a time. Report the counts.
3. `p3-prioritization-roadmap.spec.ts`, `p4-raid-governance.spec.ts` and every spec you change pass on the real stack, `--workers=1`, chromium-en and chromium-ar, in both locale settings. Report the counts. Record F-DG5-143's failure before the fix.
- `node tools/gates/validate.mjs --historical --stage DG4` exits 0 at the end.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG5/T-DG5-FE-RG2-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-FE-RG2-evidence/`. Include:
- the files changed;
- for each finding: the cause, the fix (with `file:line`), the regression test, and its failing-before and passing-after output;
- the checks, with exit codes and counts;
- any contract, schema or dependency need, for the orchestrator;
- the ADR and data-dictionary statements your fix makes untrue or incomplete (for the architect's amendment task, T-DG5-ARCH-R7, if needed);
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
