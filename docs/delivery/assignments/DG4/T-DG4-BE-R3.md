# Assignment T-DG4-BE-R3: P4 implementation, p4-work-split repair scope (below) (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/be-r3`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-BE-R3, T-DG4-KBE-R3, T-DG4-FE-R1 and T-DG4-FE-E run in their own worktrees; none owns your files. Everything through W14 (ARCH-R2, BE-M3, KBE-G2, FE-D) is merged (D-090 to D-111). Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** the "Repair scope" list below replaces a work-split section. It gives your file ownership and what to prove. Follow it exactly.
- **The shared rules:** `p4-work-split.md` §1 (S-1…). Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0025 onward), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-088 to D-090 in `docs/delivery/decisions.md`. Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p4-pending-*.ts` list. Exercise it in your `p4-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.

## Repair scope (this assignment replaces a work-split section; each item cites its source, under `docs/delivery/handbacks/DG4/`)

1. **Modular G3 waiver** (D-110; ARCH-R2 item 1, ADR-0021 and ADR-0038 amendments of 2026-10-10). Implement it exactly as specified:
   - the one changed condition in `portfolio/dispensations.ts`;
   - the snapshot record of the waiver used;
   - `gate.modular_waiver_revoked` and `gate.modular_waiver_expired` at approval.

   Prove all three of these:
   - a Modular G3 with no links and an accepted unexpired waiver → 201;
   - a revoked or expired waiver → the refusal;
   - **every other DG3 dispensation response and every End-to-End G1–G4 response byte-identical.** Reuse BE-M2's A/B recorded-response method and extend it to the dispensation responses.
2. **`getInheritedRecord`** (ARCH-R2 item 3): route it in `reporting/modular.ts` so `createInheritedRecord`'s `Location` resolves. Move it out of `p4-pending-arch-r2.ts`.
3. **Governance → RAID** (ARCH-R2 item 6): add `raid` to governance's `dependsOn` and replace `governance/meeting-actions.ts`'s copy of the action insert with BE-D's `createLinkedAction`. Keep the module graph acyclic and the boundary tests green. Prove the rows and audit events are unchanged.
4. **Meeting-action My Work sync** (BE-F2 handback §8): a meeting action whose owner or due date changes, or which closes, through `raid/actions.ts` or the DG2 `/actions` path, updates its `meeting_action_due` item through BE-R1's reschedule and reassign services. Prove each case.
5. **`work_item.system_managed` text** (ARCH-R2 item 7): adopt the neutral English text the ADR-0025 amendment gives.
6. **G6 test scope** (ARCH-R2 handback): `g5-g6.test.ts` asserts nothing under `docs/delivery/` changes, so a concurrent agent's live transcript under `docs/delivery/runs/` makes it fail. Narrow the assertion to the delivery records a G6 approval could plausibly be confused with:
   - `docs/delivery/gates/**`, `stages.json`, `findings.json` and `reviews/**`;
   - `decisions.md` and `requirements.csv`.

   Exclude `runs/**`. Keep the assertion's intent (G6 never implies DG7) and say exactly which paths it covers.
7. **Outsider status consistency** (BE-M3 handback): workstream writes give a cross-organization outsider 404, while `reporting/modular.ts` gives 403. Make both follow the rule the ADRs state, and if they state none, the 404 rule of S-4. Prove it.
- **Media-type pin:** if you add a JSON request body, add it to the pin in `contract.test.ts` at your base commit and report the delta. The orchestrator reconciles concurrent pins.
- **Disk:** check `df -h .` before each full test run. Under 3 GB free, stop and report it (D-104).
- **No migration number is yours** (`0001`–`0060` are taken). If you need a schema change, stop and put it in your handback.
- **Production wiring (D-107):** if a route depends on wiring in `server.ts` that you may not edit, say so first in your handback. Also add a test that builds the real server through the harness without wiring anything by hand.
- **Codes:** use the codes and English texts of the ARCH-R1 and ARCH-R2 consolidated tables (rows 1–185; `docs/delivery/handbacks/DG4/T-DG4-ARCH-R{1,2}-solution-architect.md`) and the dated ADR amendments. Flag any new code in your handback.
- **G6 test:** `apps/api/test/integration/workflows/g5-g6.test.ts` asserts that nothing under `docs/delivery/` changes while it runs. Keep your test logs in `$TMPDIR` during the suite and copy them to your evidence folder afterwards.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 25300–25349 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
- **Before tests:** remove any empty `.claude/.cc-writes` directories inside source folders.
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
2. `pnpm test` passes with the locale unset and with `C.UTF-8`, in both Vitest invocations. Report the counts.
3. `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm test:integration` passes. Report the counts and any pinned-count change.
4. `node tools/gates/validate.mjs --historical --stage DG3` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG4/T-DG4-BE-R3-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-BE-R3-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
