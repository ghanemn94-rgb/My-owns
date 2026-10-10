# Assignment T-DG4-FE-G2: P4 implementation, p4-work-split §J+K JK.7 (the second half of FE-G) (frontend-ux-engineer)

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/fe-g2`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-FE-F2, T-DG4-FE-G2, T-DG4-QA-B and T-DG4-ARCH-R3 run in their own worktrees; none owns your files. Everything through W16 (FE-D2, FE-F, FE-G, QA-A) is merged (D-090 to D-113). Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end.
  - Work in the order your section gives.
  - If you pass about 100 minutes, finish the current item, make the tree typecheck and lint, and write the handback, listing exactly what remains. Name its separable second half if your section gives one (D-059/D-070).

## Binding scope

- **Your section:** `docs/architecture/p4-work-split.md` §J+K JK.7 (the second half of FE-G). It gives your file ownership, consumed contracts, requirement rows and integration notes. Follow it exactly.
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

## Your scope (the second half of FE-G; §J+K JK.7)

1. **Traceability** in `pages/traceability/**` (ADR-0038; BE-M):
   - the graph with clickable nodes, and unreadable records counted, never listed;
   - the orphan report;
   - the impact panel (REQ-S03-006);
   - allocation sets, with 110 % refused and the unallocated share shown.
2. **Modular entry** (BE-M2, BE-R3):
   - the missing-link view: baseline and outcome links, with the waiver shown when one is in force;
   - the inherited-records view and form: create, the `getInheritedRecord` read, withdraw;
   - the inherited labels on gates.
3. **Portfolios and workstreams** (BE-M3; REQ-S03-001): lists, create and edit, one placement at a time, and `WS-nn` codes. The outsider and business-unit scope rules are in the BE-M3 handback §2.3.

4. **The dashboard RAG policy screen** (ADR-0037 §3; KBE-G; named by FE-G as unassigned):
   - read and edit the RAG policy with its version-0 `ETag: "0"` and the `If-Match: "0"` first save (D-109);
   - the area thresholds and the deadline horizon;
   - authorized users only, with every refusal translated.
5. **The transformation filter chip (REQ-S13-002):**
   - **Requirement:** REQ-S13-002 lists organization, transformation, owner, period, phase and status (ADR-0037 §4).
   - **What FE-G built:** its `FilterBar` has period, business unit, owner, phase and status, but no transformation chip.
   - **Add:** a repeatable transformation chip on the organization-wide dashboards, at most 50, offering only readable transformations, and show the organization as the scope.
   - **The business-unit chip** came from the orchestrator's FE-G assignment, not from the requirement. It stays as a convenience over the transformation filter (D-113).

Read ADR-0038, the BE-M, BE-M2, BE-M3 and BE-R3 handbacks, and D-108, D-110 and D-111 first.
## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 25850–25899 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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

Write `docs/delivery/handbacks/DG4/T-DG4-FE-G2-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG4/T-DG4-FE-G2-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract or schema need, for the orchestrator;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
