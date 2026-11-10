# T-DG6-BE-RG2: assistant history channel and the pre-0128 suggestion rule (F-DG6-960, F-DG6-970, F-DG6-980, F-DG6-971)

## What to change (read first)

Read F-DG6-960, F-DG6-970, F-DG6-980 and F-DG6-971 in `docs/delivery/findings.json`, the round-2 sidecars under `docs/delivery/reviews/DG6/round-2/`, and their probes and logs under `docs/delivery/test-evidence/DG6/{domain,code-security,qa}/round-2/`. F-DG6-960, 970 and 980 are the same defect, found independently by all three reviewers. Reuse their probes as your before-fix reproductions. Your own T-DG6-BE-RG1 handback and the ADR-0059 §9 amendment are the starting point.

1. **History channel (F-DG6-960/970/980, Medium).** An earlier answer that the read-time check withholds from the caller must not reach the model again, and no new answer may re-serve its text. Do both, as defence in depth:
   - `historyOf` (conversations.ts) applies the same §9 readability check (citations ∪ context, the pre-0128 fallback included) to each earlier assistant answer, for the caller at the time of the request. It drops each withheld answer from the history sent to the model, or replaces it with a neutral placeholder. Say which you chose and why.
   - The new answer's stored `context_records` also include the context records (or, pre-0128, the record citations) of every history answer given to the model. A later revocation then withholds the new answer too. Keep the 20-item cap in the 0128 shape function consistent: if the union can exceed it, decide (raise the cap in a new migration, or store a bounded union and withhold when truncated) and justify the choice.
   - Check the suggestion path and any other place that feeds earlier turns to the model.
2. **Pre-0128 suggestions (F-DG6-971, Low).** A suggestion stored before 0128, with a NULL context and readable citations, must be takeable to a draft (200), as the ADR and data dictionary say. A new migration (the next free id, 0129) replaces the NOT VALID CHECK `assistant_suggestion_context_records_required`, for example with a BEFORE INSERT trigger, so that new rows still require the context while updates of old rows pass. Keep `assistant_message` consistent.
3. **Tests on the real API (integration, shipped `http_endpoint` provider, fake model),** each with a before-fix log (fails) and an after-fix log (passes):
   - the reviewers' history sequence: answer A1 is generated from records X and Y, Y is revoked, and A1 is withheld. Then a follow-up question: the request to the model holds no A1 text, and no served answer contains it;
   - the inheritance: a new answer generated with a history answer whose context later becomes unreadable is withheld;
   - the pre-0128 suggestion is taken to a draft (200), and a new suggestion without a context is still refused at INSERT;
   - the RG1 cases in `context-recheck.test.ts` still pass.
4. **Records.** Amend ADR-0059 §5/§9, the data dictionary (0129) and the OpenAPI descriptions if any change.

## Stage and working tree

- **Stage:** P6 "Integration and system hardening", gate DG6 (FIXING after clean re-gate review round 2).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg6/be-rg2`, at the integrated `HEAD`.
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
- **Decisions:** D-193 to D-196 and D-212 to D-238 in `docs/delivery/decisions.md` (D-195 decides p6-plan Q1–Q14; D-196 decides the ARCH-01 handback questions). Read them verbatim.
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
- **Your harness ports are 31400–31449 only.** Use them for `QA_PG_PORT`, `E2E_PG_PORT`, `E2E_API_PORT` and `MTH_PORT_POOL`.
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
3. The full `pnpm test:integration` is **not** required here (it takes over an hour on this host); the orchestrator runs it on the merged tree. Run every integration file your change touches inside `tests/qa/support/with-pg.sh`, and report the counts: at least every file under `apps/api/test/integration/assistant/` and the migration tests.
4. `node tools/gates/validate.mjs --historical --stage DG5` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG6/T-DG6-BE-RG2-backend-workflow-engineer.md`, with logs under `docs/delivery/handbacks/DG6/T-DG6-BE-RG2-evidence/`. Include:
- the files changed;
- the behaviour delivered, per requirement row, quoting its acceptance text;
- the checks, with exit codes and counts;
- the operations you routed, as a delta to your pending list;
- any contract, schema or dependency need, for the orchestrator;
- the user-facing texts your work made untrue, and what you did about each;
- what remains.

Leave your changes **uncommitted** for the orchestrator to integrate.
