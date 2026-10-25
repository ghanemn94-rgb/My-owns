# Assignment T-DG5-BE-V2B: DG5 round-1 repair, continuation of T-DG5-BE-V2 (backend-workflow-engineer)

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5, **FIXING** after review round 1 (D-170).
- **Working tree:** `/home/user/wt/dg5-be-v2`, branch `dg5/be-v2`, at `acf4629` (T-DG5-BE-V2's committed repair of F-DG5-101). `node_modules` is installed and the packages are built. Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG5-BE-V1, T-DG5-BE-V3 and T-DG5-FE-V1 run at the same time in their own worktrees. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** about 1 hour. Run `date -u` at the start and at the end.

## Scope (decided by the orchestrator on T-DG5-BE-V2's observation)

- **Read first:** `docs/delivery/handbacks/DG5/T-DG5-BE-V2-backend-workflow-engineer.md`, in particular "Observation, not changed", and D-170 in `docs/delivery/decisions.md`.
- **The gap.** `POST …/steps/{key}/evidence` (`linkEvidence`, `apps/api/src/modules/procedures/steps.ts` about lines 1420-1438) links evidence to a step. On an adopted step it requires the evidence to belong to T, but not that the acting person can read T. F-DG5-101's rule applies to it as well: **a person never links a record they cannot read.**
- **The fix.** Apply the same check BE-V2 added (`requireOutputRead(tx, acting.principal, t)`, or its equivalent for the evidence's own scope) in the evidence-link path, inside the completing transaction, after the locks the path already takes. A refused link answers like an unknown evidence record, with the same problem code the path uses today for a record outside scope; nothing is linked. Keep the audit behaviour BE-V2 chose: the existing `authorization.denied` event, with no new event type.
- **Check the siblings.** Check every other step-level link or attach path in `apps/api/src/modules/procedures/**` for the same gap: anything that names a record by id and writes a link to it. Close each one the same way, or prove with a test that no gap exists. List each path in the handback.
- **Tests:** add, in `apps/api/test/integration/procedures/output-read-authorization.test.ts` or a sibling file:
  - the refusal (an organization-scope actor who cannot read T links T's evidence: refused, nothing linked);
  - the positive path (an actor who can read T links it).
  Show each new refusal test failing before your change and passing after it.
- **Do not change the contract.** No new operation and no new response shape.
- **Shared rules:** `docs/architecture/p5-work-split.md` §2.
- **Load rule (D-164):**
  - Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time.
  - Then run `unit-node` with the locale unset and with `C.UTF-8`, and `apps/api/test/integration/procedures` plus `apps/api/test/integration/contract/contract.test.ts` through `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration <paths>`.
  - The repository-wide suites are "not run, D-164".
- **Ownership:** `apps/api/src/modules/procedures/**` and `apps/api/test/integration/procedures/**`.
- **Not yours:** `tests/qa/**`. The orchestrator applies BE-V2's proposed a02 fixture hunk at the merge.

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`, offline.
- **Ports:** your harness ports are 23050–23099 only.
- **Before each test run:** remove any empty `.claude` and `.cc-writes` directories inside source folders. BE-V2's first unit run tripped `architecture.test.ts` on one.
- **Never** use `pkill -f` or `pgrep -f`.
- **The write guard forbids editing:**
  - `tools/gates/**`, `tools/agents/**` and `.claude/**`;
  - `docs/source/**`;
  - review and gate records, `stages.json` and `findings.json`;
  - `trading_agent/`.

## Evidence honesty and handback

- **Evidence honesty:** report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, and timeout. Never report a check as passed that did not run.
- **Handback:** write `docs/delivery/handbacks/DG5/T-DG5-BE-V2B-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-BE-V2B-evidence/`. Include:
  - the files changed;
  - for each path you closed: the cause, the fix (`file:line`) and the failing-before and passing-after output;
  - the paths you proved closed;
  - the checks, with exit codes and counts;
  - the ADR statements for T-DG5-ARCH-R4;
  - what remains.
- Leave your changes **uncommitted** for the orchestrator to integrate.
