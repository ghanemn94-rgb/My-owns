# T-DG6-BE-Z13: automation marker tokens, inbox redaction, label copy (F-DG6-520, 541, 560, 540, 561)

## What to change (read first)

Read D-226 verbatim, then each finding in full in `docs/delivery/reviews/DG6/round-8/*.findings.json` with the reviewers' reproductions under `docs/delivery/test-evidence/DG6/{domain,code-security,qa}/round-8/`. Re-run each reproduction before your fix (it must fail) and after (it must pass); keep both logs.

1. **Automation conditions (F-DG6-520, 541, 560).** Replace the ordinal pairing in `apps/api/src/modules/automation/versions.ts` (`keepRestrictedLiterals`) with the D-226 opaque token `[restricted:k]`: read shows tokens; a save maps tokens to their literals wherever the condition now sits (remove, reorder, in-list elements); an unknown token or the bare `[restricted]` text is refused 422 with a reason (en/ar problem text); marker text is never stored. Cover: removing an earlier condition, reordering, removing the restricted condition itself, in-list element removal and reordering, two hidden literals, and the admitted reader seeing real values afterwards. Update the web editor so the label follows the token, OpenAPI, zod and `AUTOMATION_RESTRICTED_LITERAL`.
2. **Inbox (F-DG6-540).** Apply D-218 to `listMyInbox` and `markInboxNotificationRead`: restricted target (direct or a child source such as finance_validation, benefit_overlap of a sensitive benefit) gives `inbox.restricted`, params `{}`, linkPath to the transformation home, and `includesRestrictedRecords: true`. Classify the inbox columns in the sensitive reference inventory so its test covers them; the inventory must still pin zero open and zero PENDING rows.
3. **Label copy (F-DG6-561).** Make the restricted label's description contextual (total vs row/link/condition), en and ar, on every place that uses it.

## Stage and working tree

- **Stage:** P6 "Integration and system hardening", gate DG6 (FIXING after review round 8).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg6/be-z13`, at the integrated `HEAD`.
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
- **Decisions:** D-193 to D-196 and D-212 to D-226 in `docs/delivery/decisions.md` (D-195 decides p6-plan Q1–Q14; D-196 decides the ARCH-01 handback questions). Read them verbatim.
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
- **Your harness ports are 31150–31199 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
3. The full `pnpm test:integration` is **not** required here (it takes over an hour on this host); the orchestrator runs it on the merged tree. Run every integration file your change touches inside `tests/qa/support/with-pg.sh`, and report the counts. At least: the worker job, failure-queue and automation-recovery files, the `operations` and operational-exception files, and the BE-Z6 race test. Also run `e2e/a22-p6-operability.spec.ts` and `e2e/a13-automation-recovery.spec.ts` on the real stack in both locales.
4. `node tools/gates/validate.mjs --historical --stage DG5` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG6/T-DG6-BE-Z13-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG6/T-DG6-BE-Z13-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
