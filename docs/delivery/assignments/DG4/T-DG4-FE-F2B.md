# Assignment T-DG4-FE-F2B: salvage and completion of T-DG4-FE-F2 (frontend-ux-engineer)

## Salvage of the interrupted run (D-103; the D-059/D-070 precedent)

- **What happened:** the first T-DG4-FE-F2 run started at about 08:43Z. A container restart killed it at 09:37Z, after about 55 minutes, before it finished its checks.
- **What it left:**
  - The orchestrator committed its working tree, unverified, as WIP commit `14a8476` on branch `dg4/fe-f2`. That commit is your starting point.
  - The killed run's transcript is kept at `docs/delivery/test-evidence/DG4/fe-f2-orphaned/` **for provenance only**. Do not cite it.
  - Do not trust any partial log or claim the WIP contains. A log or handback text from before this run is stale: delete or rewrite it, and produce fresh evidence.
- **Your job:** this assignment is the complete scope. The original assignment, `docs/delivery/assignments/DG4/T-DG4-FE-F2.md`, is reproduced below unchanged.
  1. Review the WIP critically against the scope, the ADRs and the shared rules, as if someone else wrote it. Fix whatever is wrong or missing.
  2. Complete the remaining items.
  3. Run every acceptance check from scratch on your final tree.
- **Handback:** write it as `docs/delivery/handbacks/DG4/T-DG4-FE-F2-frontend-ux-engineer.md` (the original task's name), with logs under `docs/delivery/handbacks/DG4/T-DG4-FE-F2-evidence/`. Add a section "Salvage" that lists:
  - what you kept from the WIP;
  - what you changed, and why;
  - what you added.
- **Time:** the 2-hour limit counts from your own start.
- **Concurrency:** the other three W17 tasks restart from their own WIP at the same time, in their own worktrees.

---

## Original assignment: T-DG4-FE-F2: P4 implementation, p4-work-split §H H.6 (the second half of FE-F) (frontend-ux-engineer)

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/fe-f2`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-FE-F2, T-DG4-FE-G2, T-DG4-QA-B and T-DG4-ARCH-R3 run in their own worktrees; none owns your files. Everything through W16 (FE-D2, FE-F, FE-G, QA-A) is merged (D-090 to D-113). Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** `docs/architecture/p4-work-split.md` §H H.6 (the second half of FE-F). It gives your file ownership, consumed contracts, requirement rows and integration notes. Follow it exactly.
- **The shared rules:** `p4-work-split.md` §1 (S-1…). Reviewers check every one of them.
- **The design:** the ADRs your section cites (ADR-0025 onward), `docs/api/openapi.yaml`, and the zod mirrors.
- **Decisions:** D-088 to D-090 in `docs/delivery/decisions.md`. Read them verbatim.
- **Pending operations:** move each operation you route out of your `apps/api/test/support/p4-pending-*.ts` list. Exercise it in your `p4-exercises-*.ts` so `contract.test.ts` stays green.
- **Acceptance texts:** the `acceptance` text of every requirement row your section assigns to you (`docs/delivery/requirements.csv`) is binding, and reviewers test it literally.
- **Gates:** product gates G1–G6 are business approvals inside the product. No agent grants a real business, Finance or IT approval. Seed and demo data are synthetic.
- **Shared web files** (`router.tsx`, `nav.ts`, `Workspace.tsx`, `nav.json`, `problems.json`, `myWork.json`, `i18n/index.ts`): append-only edits, so the orchestrator can merge by union. Never reorder or rewrite another task's entries. FE-R1 (D-112) and the W16 tasks (D-113) already placed the `problems.json` keys of slices H, I, C, A, J and K and the work-item message keys from the ARCH-R1/R2 tables. Add only keys that are still missing, and list each one in your handback.
- **Never show Unknown, Stale or n/a as 0 or green.** Mark Arabic labels provisional where the ADR says so.
- **Checks at narrow width:** test every screen at 390 px and at 200% text size.
- **Disk:** check `df -h .` before each full test run. Under 3 GB free, stop and report it (D-104).
- **G6 test:** BE-R3 narrowed `g5-g6.test.ts` to the gate records, so your run logs no longer trip it. Still keep your test logs in `$TMPDIR` during a suite and copy them to your evidence folder afterwards.
- **e2e under load:** three other agents run at the same time, so a step can be slow. If a test hits the 30 s timeout, re-run that spec alone and report both runs. Never raise a timeout to get green without naming the slow step and its cause.

## Your scope (the second half of FE-F; §H H.6)

1. **Change requests** in `pages/change-requests/**` (ADR-0036; BE-L; BE-R2):
   - create a change request on its subject (KPI, rebaseline and the other subject types the contract lists);
   - show the materiality and the impact preview (outcomes, benefits, gates, reports, formulas);
   - impact assessments;
   - submit, decide through T11 routing, and withdraw through the approval (round 2 is requester-only, ADR-0026 amendment E1–E6);
   - show the original approvals and snapshots as preserved.
   Translate every ADR-0036 §10 code still missing.
2. **The phase workspace** (ADR-0036 and ADR-0035 phase sections; BE-L2):
   - the phase catalogue;
   - guided steps, with the version-0 `ETag: "0"` read and the `If-Match: "0"` first save (D-109);
   - step evidence;
   - the review queue.
   Add one route and its nav and workspace entries, append-only.
3. **Scale transitions and risk dispositions** (BE-K; ADR-0035; FE-F handback "What remains"):
   - the scale-transition action, refused before G5 approval with the translated invalid-transition naming G5 (REQ-S03-004), and blocked outside the approved scale scope (REQ-S04-007);
   - recording a risk disposition for an open material risk, so a G5 submission can be completed with native screens only.

Read the BE-L, BE-L2 and BE-R2 handbacks and D-108 to D-110 first.
## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 25700–25749 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
4. The product e2e suite (`apps/web/e2e`, real stack via `apps/web/e2e/support/with-stack.sh`, `--workers=1`) passes in chromium-en and chromium-ar, including your new specs, with axe reporting 0 serious or critical issues. Report the counts per spec.
5. `node tools/gates/validate.mjs --historical --stage DG3` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG4/T-DG4-FE-F2-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-FE-F2-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
