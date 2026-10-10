# Assignment T-DG4-QA-BB: salvage and completion of T-DG4-QA-B (qa-verifier)

## Salvage of the interrupted run (D-103; the D-059/D-070 precedent)

- **What happened:** the first T-DG4-QA-B run started at about 08:43Z. A container restart killed it at 09:37Z, after about 55 minutes, before it finished its checks.
- **What it left:**
  - The orchestrator committed its working tree, unverified, as WIP commit `ea92e25` on branch `dg4/qa-b`. That commit is your starting point.
  - The killed run's transcript is kept at `docs/delivery/test-evidence/DG4/qa-b-orphaned/` **for provenance only**. Do not cite it.
  - Do not trust any partial log or claim the WIP contains. A log or handback text from before this run is stale: delete or rewrite it, and produce fresh evidence.
- **Your job:** this assignment is the complete scope. The original assignment, `docs/delivery/assignments/DG4/T-DG4-QA-B.md`, is reproduced below unchanged.
  1. Review the WIP critically against the scope, the ADRs and the shared rules, as if someone else wrote it. Fix whatever is wrong or missing.
  2. Complete the remaining items.
  3. Run every acceptance check from scratch on your final tree.
- **Handback:** write it as `docs/delivery/test-evidence/DG4/qa/T-DG4-QA-B-authoring/HANDBACK-T-DG4-QA-B-qa-verifier.md` (the original task's name), with logs under `docs/delivery/test-evidence/DG4/qa/T-DG4-QA-B-authoring/`. Add a section "Salvage" that lists:
  - what you kept from the WIP;
  - what you changed, and why;
  - what you added.
- **Time:** the 2-hour limit counts from your own start.
- **Concurrency:** the other three W17 tasks restart from their own WIP at the same time, in their own worktrees.

---

## Original assignment: T-DG4-QA-B: executable acceptance suites A08 and A09 (qa-verifier, authoring)

## Stage and working tree

- **Stage:** P4 "Execution value and sustainment", gate DG4 (BUILDING).
- **Kind of task:** **authoring**, not a gate review. You write executable acceptance suites from the acceptance texts and the contract, and run them on the integrated tree before the freeze.
  - Authoring them does not make you the DG4 gate reviewer. The independent DG4 QA review is a separate round, run by a separate session (the T-DG1-QA precedent).
  - p4-plan §5.1 lists this task as QA-B, slice L.
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg4/qa-b`, at the integrated `HEAD`.
  - `node_modules` is installed and the packages are built.
  - Do not run `pnpm install` or `pnpm -r build`; the product tree is read-only to you.
  - Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG4-FE-F2, T-DG4-FE-G2, T-DG4-QA-B and T-DG4-ARCH-R3 run in their own worktrees; none touches your files. Everything through W16 is merged (D-090 to D-113). QA-A's suites (A04, A05, A10) are in `tests/qa/**` and `e2e/**`; reuse its support files, and add your own files beside them.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG3` first, and report the result. It must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. If you pass about 100 minutes, finish the current suite, make it pass or mark exactly what fails, and write the handback listing what remains.

## Files you may write

- `tests/qa/**`: the Vitest `integration` project picks up `tests/qa/integration/**`, and `unit-node` picks up `tests/qa/unit/**`. Reuse `tests/qa/support/{api.ts,with-pg.sh}`. Extend them only by adding new files or new exports.
- root `e2e/**`: acceptance-level Playwright specs. The frontend's own journeys live in `apps/web/e2e/` and are not yours. Start the stack with `apps/web/e2e/support/with-stack.sh`, as those journeys do.
- `docs/delivery/test-evidence/DG4/qa/T-DG4-QA-B-authoring/**`: your logs and your handback.

**Never** edit `apps/**` or `packages/**` product source, `tools/**`, `.claude/**`, `docs/source/**`, or any delivery record. If a suite exposes a product defect, keep the failing test, report it in the handback with the exact request and response, and do not work around it.

## Deliver: the acceptance suites

Derive every check from the acceptance texts and `docs/api/openapi.yaml`, not from the implementation.
- The scenario texts are master prompt §20 "Acceptance tests and measurable definition of done", rows `A08` and `A09`.
- The binding row texts are in `docs/delivery/requirements.csv`: every DG4 row whose `acceptance` cites the scenario.

1. **A08, gate controls.** "Missing evidence blocks submission; unauthorized approval and stale-version approval are rejected by the API."
   - API suites through the real server and a real PostgreSQL, over synthetic transformations taken to G5 and G6 with native operations only. Cover, each against its row text:
     - REQ-PB-015 and REQ-S20-008: missing mandatory evidence 422; non-approver 403; stale submission version refused;
     - REQ-PB-020 and REQ-S04-007: G5 with an open High-impact risk and no disposition is refused, listing 'Risk closure'. With the G5 approver set to BO for T11 'Go-live / scale', an SP approval is 403. An approval records the scale scope, and scaling outside it is blocked;
     - REQ-PB-021 (G6 without an accepted BAU handover is refused, listing 'Ownership transfer');
     - REQ-S03-004 (a scale transition before G5 approval is 422 invalid-transition naming G5; after approval it succeeds);
     - REQ-S04-002 (completing every phase task leaves the gate Draft; an edit after submission does not change the snapshot);
     - REQ-S04-009 and REQ-S10-014 (a decision without rationale is refused; the nine criterion fields persist; the stored record includes the request version);
     - REQ-S04-010 (the seven statuses; Draft → Approved refused; an audit event per transition);
     - REQ-S04-012 (missing items listed; 422 listing one missing mandatory item; with a valid exception it succeeds and the snapshot records it);
     - REQ-S04-013 (a waiver without expiry or compensating action is refused; after expiry the covered item is reported missing again);
     - REQ-S10-016 (self-approval of one's own scope change is 403 under the default policy);
     - REQ-S10-017 (approving version 3 after the record moved to 4 is 409);
     - REQ-S10-018 ('request changes' returns the item without closing it; 'defer' requires a new date);
     - REQ-S12-009 (each required approver gets exactly one task referencing the snapshot).
   - **Product G6 is a business approval inside the product.** Assert that a product G6 approval changes nothing under `docs/delivery/` (REQ-S04-008).
2. **A09, decision escalation.** "A working-day SLA expiration produces the correct escalation and linked executive ask without duplicate actions."
   - Cover:
     - REQ-PB-066 and REQ-S10-006 (5 working days from a Thursday or from the day before a configured holiday skip the weekend days and the holiday; no holiday exists until configured);
     - REQ-S12-011 and REQ-S20-009 (an SLA expiring on a working day escalates once, to the next authority, with the delay-impact text; no duplicate action);
     - REQ-S10-019 (after the due date plus retries, the approval is escalated exactly once and stays undecided);
     - REQ-PB-082 (a blocker Red for 2 consecutive cycles with N = 2 gives exactly one open T16 ask; re-running the job creates none);
     - REQ-PB-064 (an open T16 decision due yesterday in Asia/Riyadh makes the Decisions area Red and lists it; once recorded it no longer counts);
     - REQ-PB-068 and REQ-S10-012 (an agenda item without 'Impact of delay', or an ask without 'why now', is refused by the API);
     - REQ-PB-081 (T16 persists all 9 columns; a decision with an Outcome recorded is closed and leaves the overdue list);
     - REQ-S10-011 (no decision below quorum; published minutes immutable; actions in the owners' My Work);
     - REQ-S15-008 (observation period, business date and UTC event timestamp).
   - Drive the worker scans through the worker's exported job functions (not by sleeping), as the KBE and BE worker tests do.
   - REQ-S16-018 and REQ-S16-019 (entity groups): check that the BE-D2 and BE-F2 entity-group tests exist and pass, and add a black-box check only where they leave a listed entity uncovered.

3. **Close QA-A's partial rows** (QA-A handback, "Partial or not covered"). Extend QA-A's files only by adding new test cases or new files:
   - REQ-S07-007: the "all tasks complete" condition (a KPI below the red threshold is Red even with every task complete);
   - REQ-S13-003: the validated benefit total drills to its benefit records;
   - REQ-S08-015: pin the exact refusal code of a validation lacking a measurement period;
   - REQ-PB-075: T14 persists all 10 columns.
- **Sandbox note (QA-A):** in your confined sandbox, `node_modules` is read-only, and Vitest's config loader fails before any test runs. Add `--configLoader runner` and say so. The orchestrator re-runs the exact command where `node_modules` is writable.

## Rules

- **Real behaviour:** assert status codes, problem codes, database state, rendered `dir`/`lang` and values. Never assert implementation details.
- **Determinism:** tests must be deterministic and run offline. Use synthetic data only, with fixed dates and no random collisions. A missing tool or credential makes a check BLOCKED, never a silent pass.
- **Decimal strings:** compare amounts as decimal strings, never floats.
- **Gates:** product gates G1–G6 are business approvals inside the product; a Finance approval in a fixture is a synthetic in-product approval of test data. No agent grants a real business, Finance or IT approval.
- **Ports:** your harness ports are **25750–25799** only. Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline. Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`); never run `playwright install`.
- **Disk:** check `df -h .` before each full test run. Under 3 GB free, stop and report it (D-104).
- **Load:** three other agents run at the same time. If an e2e step hits the 30 s timeout, re-run that spec alone and report both runs.

## Acceptance (real output in the handback)

1. `QA_PG_PORT=<port> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm vitest run --project integration tests/qa` passes. Report the counts per file.
2. Your root `e2e/` spec passes in chromium-en and chromium-ar on the real stack (`--workers=1`), with axe reporting 0 serious or critical issues.
3. `pnpm lint` and `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown` exit 0 on your files.
4. **A requirement → test table.** For each row named above, give the test that proves it, or `NOT COVERED` with the reason.
5. **Mutation checks:** for at least five central assertions (at least one per scenario), show that the test fails when the asserted behaviour is broken. Use a temporary copy in `$TMPDIR` or an environment switch, and never edit product source in this tree. Keep the logs.
6. `node tools/gates/validate.mjs --historical --stage DG3` exits 0, at the start and at the end.

## Evidence honesty

Report every command with its real exit code. Disclose every non-zero exit, failed or flaky test, or timeout. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/test-evidence/DG4/qa/T-DG4-QA-B-authoring/HANDBACK-T-DG4-QA-B-qa-verifier.md`. Your role cannot write `docs/delivery/handbacks/`. Include:
- the suites authored, with what each asserts;
- the requirement → test table;
- the checks run, with exit codes and counts;
- each product defect found, with its reproduction;
- anything BLOCKED.

Leave your test files **uncommitted** in the worktree for the orchestrator to integrate. The runner commits your run evidence.
