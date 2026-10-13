# Assignment T-DG4-BE-R7: the A08 G6 delivery-fingerprint test reads 342 MB and times out on a cold disk cache (D-138)

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (FIXING after the round-9 audit, pre-freeze verification of round 10).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/be-r7`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** you run alone. Read D-138 first; it decides this repair. Your file: `tests/qa/integration/a08-gate-controls.test.ts`. Nothing else.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Time:** about 45 minutes; the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** the "Repair scope" below replaces a work-split section. It names the findings you close; their records are binding. Follow it exactly.
- **The shared rules:** `p4-work-split.md` §1 (S-1…). Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0025 onward), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-088 to D-090, D-112, D-117 and D-131 to D-138 in `docs/delivery/decisions.md`. Read them verbatim.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.

## Repair scope (test only), per D-138

- **The defect.** In the round-10 pre-freeze integration run (commit `55e13f3`, low load ~2), `tests/qa/integration/a08-gate-controls.test.ts` > 'REQ-S04-008: a product G6 approval (API and its worker consumer) changes nothing under docs/delivery/' timed out at 30 s (37.6 s; 1983/1984 passed). Its `deliveryFingerprint()` reads and SHA-256-hashes every file under `docs/delivery/` except `runs/` and `test-evidence/`, **twice**: 4,947 files, 342 MB, of which `handbacks/` is 322 MB of evidence. Warm, a pass takes about 0.6 s; cold, at the ~16 MB/s measured on this disk right after that run, about 21 s, so two passes exceed the 30 s limit. The cost grows with every round's handbacks. The orchestrator's log: `docs/delivery/handbacks/DG4/T-DG4-BE-R7-evidence/00-orchestrator-integration-r10.log` (copied there for you).
- **The precedent.** T-DG4-BE-R3 fixed the same pattern in `apps/api/test/integration/workflows/g5-g6.test.ts` (`DELIVERY_RECORDS`: `gates`, `stages.json`, `findings.json`, `reviews`, `decisions.md`, `requirements.csv`; a missing path is listed, never skipped; D-112).

1. Narrow `deliveryFingerprint()` in `a08-gate-controls.test.ts` the same way, with the same set and the same missing-path rule, and update its doc comment to say why (the records a product G6 approval could be confused with; handbacks, assignments, candidates, runs, test evidence and progress notes are not gate state). Keep the assertion's intent and every existing assertion: the fingerprint covers `stages.json`, `findings.json`, `requirements.csv` and at least one `gates/DGx.json`, and is equal before and after the approval and its worker consumer.
2. Do not raise the timeout, skip, or weaken the test.
3. **Show the cost.** Measure the fingerprint's file count, bytes and time before and after your change (a small script under your evidence folder is fine).
4. **Show it is not vacuous.** On a scratch copy, make the product write to one of the covered records (for example append a byte to `decisions.md` between the two fingerprints in a scratch copy of the test) and show the assertion fails; then revert.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 26250–26299 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
- **Before tests:** remove any empty `.claude/.cc-writes` directories inside source folders.
- **The write guard forbids editing:**
  - `tools/gates/**`, `tools/agents/**` and `.claude/**`;
  - `docs/source/**`;
  - review and gate records, `stages.json` and `findings.json`;
  - `trading_agent/`.

## Acceptance (real output in the handback)

1. These all exit 0: `pnpm -r typecheck`, `pnpm lint`, and `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`.
2. `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/a08-gate-controls.test.ts` passes 3 times. Report the counts and the G6 test's duration.
3. The full integration suite (`QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm test:integration`) passes once. Report the counts (1984 expected).
4. `node tools/gates/validate.mjs --historical --stage DG3` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG4/T-DG4-BE-R7-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-BE-R7-evidence/`. Include:
- the files changed;
- the checks, with exit codes and counts;
- the before/after cost and the non-vacuity demonstration;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
