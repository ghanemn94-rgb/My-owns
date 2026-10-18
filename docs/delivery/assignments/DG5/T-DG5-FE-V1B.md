# Assignment T-DG5-FE-V1B: DG5 round-1 repair, continuation of T-DG5-FE-V1 plus the gate-readiness line (frontend-ux-engineer)

## Continuation of T-DG5-FE-V1 (read first; D-147/D-151 salvage). This comes before the gate-readiness scope below.

- **What happened:** T-DG5-FE-V1 (run `DG5-T-DG5-FE-V1-frontend-ux-engineer-20261018T051623Z-9df298b7`) was stopped by a container restart at about 06:27Z, during its e2e runs and before it wrote its handback. Its run folder is kept for provenance only in `docs/delivery/test-evidence/DG5/FE-V1-orphaned/`.
- **What it left:** its working tree is committed, unverified, as WIP `c89f9a0` on branch `dg5/fe-v1`, your `HEAD`. It holds:
  - the reflow and focusable-region changes;
  - `apps/web/e2e/p5-reflow-axe.spec.ts`;
  - `apps/web/src/components/table-regions.test.tsx`;
  - the `p2-journeys.spec.ts` change;
  - its logs in `docs/delivery/handbacks/DG5/T-DG5-FE-V1-evidence/`, which include before-fix runs, static checks, unit-web in both locales and a partial e2e log.
- **What you do first:**
  1. Read `docs/delivery/assignments/DG5/T-DG5-FE-V1.md`, its scope for F-DG5-140, F-DG5-141 and F-DG5-121. It is binding for you.
  2. Read the WIP diff (`git show c89f9a0`) and check it against that scope. Complete anything missing.
  3. Run FE-V1's acceptance on the final tree. The WIP's logs are not a substitute; record new logs under `docs/delivery/handbacks/DG5/T-DG5-FE-V1B-evidence/`.
  4. Your handback covers both scopes: FE-V1's three findings, each with the failing-before evidence FE-V1 recorded and your passing-after evidence, and the gate-readiness line below.
- **Then** do the gate-readiness scope below, and run its checks on the final tree. One combined set of static checks and one combined e2e run (FE-V1's specs plus the gates spec) is enough.
- **Time:** about 1 h 45 min in total.

## Stage and working tree

- **Stage:** P5 "Configuration automation and outputs", gate DG5, **FIXING** after review round 1 (D-170).
- **Working tree:** `/home/user/wt/dg5-fe-v1`, branch `dg5/fe-v1`, at WIP `c89f9a0` (T-DG5-FE-V1's salvaged tree). `node_modules` is installed and the packages are built. Work only in this tree. Never run `git worktree add`.
- **Concurrency (D-004):** T-DG5-BE-V2C runs at the same time in its own worktree. T-DG5-BE-V1 and T-DG5-BE-V3 are merged into the integration branch, but not into yours. Stay strictly inside your file ownership.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG4` first, and report the result. It must exit 0.
- **Time:** about 1 h 45 min in total (see the continuation section). Run `date -u` at the start and at the end.

## Scope (decided by the orchestrator on T-DG5-BE-V3's web need, F-DG5-120)

- **Read first:**
  - `docs/delivery/handbacks/DG5/T-DG5-BE-V3-backend-workflow-engineer.md` §5 and §7 (on the integration branch: `git show claude/mobily-transformation-platform-regate:docs/delivery/handbacks/DG5/T-DG5-BE-V3-backend-workflow-engineer.md`);
  - D-170 in `docs/delivery/decisions.md`.
- **The gap.** On a gate whose mandatory criteria are partly covered by accepted exceptions, the readiness line reads only "{{complete}} of {{total}} mandatory outputs complete":
  - the gate page, `apps/web/src/pages/gates/GateDetailPage.tsx:233`;
  - the gates list, `apps/web/src/pages/gates/GatesPage.tsx:133`.
  On the demo's approved G4 this reads "6 of 8 mandatory outputs complete" next to "Approved", with no word that the other two are covered by accepted exceptions. D-170 asks that no approved gate page show a bare "N of M complete".
- **The fix (option 1 of BE-V3's handback; no contract change):**
  - Wherever the readiness line is shown, when one or more incomplete mandatory criteria are covered by an accepted, unexpired exception, say so in the same line or directly with it.
  - Use the data the server already returns: each exception's `covering`, the criterion state and the gate status.
  - Add a gate-page variant of the existing `gates.submit.coveredNote`, in en and ar. An example: "6 of 8 mandatory outputs complete; the other 2 are covered by accepted exceptions."
  - A gate with no covering exception reads as it does today. An expired exception does not count as covering, consistent with the server.
  - The `ready` icon follows the server's readiness, not a client prediction.
- **Tests:**
  - A unit test (`apps/web/src/pages/gates/**`) for:
    - a gate with covered criteria (the new text, en and ar);
    - a gate without exceptions (the text unchanged);
    - a gate with an expired exception (not counted).
  - Add an assertion to your FE-V1 reflow spec, or to a gates spec, only if one already visits a gate page with exceptions; otherwise the unit test is enough.
- **Do not change the contract.** No new operation and no new response shape.
- **Shared rules:**
  - `docs/architecture/p5-work-split.md` §2;
  - Arabic RTL and English LTR for every new string;
  - the translation guard tests must pass.
- **Load rule (D-164):**
  - Run `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, the prettier check and `pnpm openapi:lint`, once each and one at a time.
  - Then run the `unit-web` Vitest project with the locale unset and with `C.UTF-8`, one at a time.
  - Then run the gates e2e spec(s) that render the readiness line, once, `--workers=1`, in chromium-en and chromium-ar, through `apps/web/e2e/support/with-stack.sh`.
  - The repository-wide suites are "not run, D-164".
- **Ownership:** `apps/web/**` (the gates pages and their i18n strings and tests).

## Environment

- **Node:** 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`, offline.
- **Browser:** Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Ports:** your harness ports are 23150–23199 only.
- **Before each test run:** remove any empty `.claude` and `.cc-writes` directories inside source folders.
- **Never** use `pkill -f` or `pgrep -f`.
- **The write guard forbids editing:**
  - `tools/gates/**`, `tools/agents/**` and `.claude/**`;
  - `docs/source/**`;
  - review and gate records, `stages.json` and `findings.json`;
  - `trading_agent/`.

## Evidence honesty and handback

- **Evidence honesty:** report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, and timeout. Never report a check as passed that did not run.
- **Handback:** write `docs/delivery/handbacks/DG5/T-DG5-FE-V1B-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG5/T-DG5-FE-V1B-evidence/`. Include:
  - the files changed;
  - the behaviour, with en and ar text;
  - the tests;
  - the checks, with exit codes and counts;
  - what remains.
- Leave your changes **uncommitted** for the orchestrator to integrate.
