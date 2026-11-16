# Handback T-DG7-ARCH-R6 (solution-architect): ADR-0064 Amendment 5, A3.9 residual 1 decided (D-278)

- **Stage:** DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `HEAD` `6f10ccc78a4f9acd08051ae6a26dbe776ebf2767`, verified with `git rev-parse HEAD`. At the start, `git status` was clean apart from this run's own `docs/delivery/runs/…` directory.
- **Requirement:** REQ-S19-017. Finding F-DG7-971 (Medium, not mandatory).
- **Invocation:** run `DG7-T-DG7-ARCH-R6-solution-architect-20261116T085831Z-03f4b14e`, session `03f4b14e-b350-48ad-b9d9-35ebc54e1b4f`.
- **Time:** started `2026-11-16T08:58:41Z` (`date -u`). The end time is in §3.
- **Two gate systems.** This is an engineering design record. It grants and implies no G1–G6, Finance or IT approval, and no DG gate. F-DG7-971 is not closed here: only a non-author reviewer can close it.

**Task id collision (assignment contradiction).** `T-DG7-ARCH-R6` was already used on 2026-11-14 for the ADR-0069 §5 launcher amendment, which was integrated in commit `3386b9092` (D-266). Its handback and evidence were already at the paths this assignment names.

- My first check run overwrote that task's `typecheck.log` for about 2 minutes, and my first draft of this handback replaced its handback.
- I stopped the run and restored both files byte for byte from `HEAD` (`git show HEAD:<path> > <path>`). `git status` showed them unmodified afterwards.
- The earlier `contract-test.log`, `docs.diff`, `lint.log`, `openapi-lint.log`, `pnpm-test.log`, `prettier-repo.log` and `validate-historical-DG6.log` were never written.
- This handback now sits at the assigned path, **above** the earlier one, which is kept verbatim after the separator at the end. My logs are in `d278/`.

The orchestrator may prefer a fresh task id and path (open question 4).

## 1. Files changed

| File | Purpose |
| --- | --- |
| `docs/architecture/adr/ADR-0064-p7-migration-manifest-export-import-reconciliation-identity-rebind.md` | Adds **Amendment 5** (A5.1–A5.7). It records D-278 word for word and specifies the exact match rule: Gate 0, S1–S9, uniqueness and S′. It also gives the window bounds, the cron semantics, the exact texts, the report fields, who builds it, tests T-S1–T-S10 and the residuals. A one-paragraph note in A3.9 residual 1 marks it **Decided 2026-11-16 (D-278): see Amendment 5**. No other existing text was changed. |
| `docs/delivery/handbacks/DG7/T-DG7-ARCH-R6-solution-architect.md` | This handback, placed **above** the earlier handback of the same task id, which is kept verbatim below the separator (see the collision note) |
| `docs/delivery/handbacks/DG7/T-DG7-ARCH-R6-evidence/d278/*.log` | Check logs (§3), in a sub-directory so that the 2026-11-14 logs in the parent directory stay untouched |

No code was changed, and neither were the register, handover texts, gate tooling, reviews, `stages.json`, `findings.json` or test evidence. No `p7-pending*.ts` entry belongs to this task, so none was removed.

## 2. Behaviour delivered per requirement

**REQ-S19-017 (A18 transfer drill), the design for the F-DG7-971 repair.**

**Where the rule lives (A5.1).** It is a drill-side second stage after the unchanged D9 `reconcile-migration --after-use` run. Mode 2 itself (`recheck.ts`, `reconcile.ts`, allowance `/4`) is not loosened. The alternatives were rejected:
- a window key in the recheck, because the product CLI has no drill window and D-278 assigns the repair to DO;
- pausing or rescheduling a job, which D-278 and A3.9 forbid;
- timing the drill.

`reconcile-d9.json` keeps the real exit 4.

**Gate 0.** The recheck output may contain only these lines:
- the attachments line;
- `explaining events` lines;
- per-table lines for `automation_execution` and `automation_action_result` with basis `audit_explained` and 0 missing;
- `unexplained added ["<uuid>"]` lines;
- the final mismatch line with 0 attachments.

Any other line, table or kind (`changed`, `missing`, `expected but not`, depth, ordinal, counter or lineage lines) means D9 FAILs as today. If a table lists 20 keys, the list may be truncated, which also FAILs.

**Rule S, per unexplained execution, read only on T.**

| # | Condition |
| --- | --- |
| S1 | added |
| S2 | `initiating_user_id IS NULL` and `run_as = 'service'` |
| S3 | `automation_trigger.trigger_kind = 'schedule'` |
| S4 | the key matches `^([a-z_]+\.[a-z_]+):([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2})$`, the code equals `trigger_code`, and the minute is read as UTC. This is the `scheduleSlotKey` format, for example `approval.escalation_scan:2026-11-16T08:00`. |
| S5 | an enabled `job_schedule` row on T has that code, and its `cron` and `timezone` are used |
| S6 | the named slot `s` is `M` if `M` is a cron occurrence, else `M − 60 s` if that is one, else none |
| S7 | `W0 − 60 s < s ≤ W1` |
| S8 | `created_at` is within `[W0, W1]` |
| S9 | its own worker or service audit event exists, with no user and `request_id` `job:…`, at `new_version = x.version` |

Two more checks apply:
- **Uniqueness:** at most one execution per (code, slot). If two share one, both FAIL.
- **S′:** each action result must be added, belong to a schedule-explained execution, have its event in `R(x)`, and follow the A4.4 ordinal and attempt structure.

**Window bounds.** Both are read with `clock_timestamp()` on T's database, the clock pg-boss uses.
- `W0` is read in D7 just before T's worker starts.
- `W1` is read in D9 just after `reconcile D9` returns.

**The pg-boss evidence behind S6 and S7.** It was read in `node_modules/.pnpm/pg-boss@11.0.0/.../timekeeper.js`:
- `shouldSendIt` sends only while `now − prev < 60 s`;
- the cron monitor runs every 30 s and the send-it poll every 5 s;
- `singletonKey` is the queue name, with `singletonSeconds` 60.

So the key minute is the slot's minute, or the next minute when the worker catches a slot up at start. A slot up to 60 s before `W0` can be sent by the D7 start.

**Report.**
- `schedule-explained-d9.json`;
- in the D9 entry of `transfer-drill-report.json`: `recheck` (`matched`, `schedule_explained` or `not_matched`), `scheduleExplained[]` (every explained execution with its key, slot, cron, timezone, action results and audit events) and `scheduleWindow`;
- exact console texts, including every FAIL reason (A5.4);
- the A18 harness re-checks S2–S8 from the report.

**Every other added or changed row stays unexplained.** A handler that writes business rows in the window, such as an escalation or `kpi.reporting_period_open` opening 2026-09, still FAILs D9.

**Tests specified for DO (A5.6).** T-S4 replays the QA round-5 output and the evidence row: it is explained, and without the stage it is a FAIL. T-S5–T-S7 violate each condition one at a time and must still FAIL. T-S8 parses every seeded cron. T-S9 shows on PostgreSQL that the stage is read only (digest unchanged).

**AN disclosure content** is named in A5.6, as D-278 requires.

## 3. Checks run (real exit codes)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, no Docker, no network.

| Command | Exit | Log |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG6` (before editing) | 0 (`PASS gate DG6 (historical)`) | `T-DG7-ARCH-R6-evidence/d278/validate-historical-DG6-before.log` |
| `npx prettier --check <ADR-0064>` | 0 | (console) |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 (`All matched files use Prettier code style!`) | `T-DG7-ARCH-R6-evidence/d278/prettier.log` |
| `pnpm -r typecheck` | 0 | `d278/typecheck.log` |
| `pnpm lint` (eslint `--max-warnings=0`) | 0 | `d278/lint.log` |
| `pnpm openapi:lint` | 0 (`PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations`) | `d278/openapi-lint.log` |
| `pnpm test` | 0 (summaries: 207 files and 3042 tests passed; 131 files and 2199 tests passed; 3 files with 259 passed and 2 skipped) | `d278/test.log` |
| `node tools/gates/validate.mjs --historical --stage DG6` (after editing) | 0 (`PASS gate DG6 (historical)`) | `d278/validate-historical-DG6-after.log` |
| Integration tests on a disposable PostgreSQL (`with-pg.sh`) | **NOT RUN, not applicable.** This task touched no integration test, no code and no contract. | — |

The run ended at `2026-11-16T09:27Z`.

**Concurrency caveat.** My first, stopped check chain ran an unlogged `pnpm test` into the earlier task's directory from about 09:12 to 09:22. That overlapped the logged `d278` run above, and its stray output was deleted. The logged run still exited 0. The repository-wide Prettier check ran **before** this handback was written. This handback was checked on its own afterwards with `npx prettier --check docs/delivery/handbacks/DG7/T-DG7-ARCH-R6-solution-architect.md`, and the ADR was re-checked the same way. Both exited 0.

## 4. Known gaps / not done

- **The rule is designed, not built.** DO must implement A5.6 (`schedule-explained.mjs`, the `transfer-drill.sh` window and stage, the harness, T-S1–T-S10), and AN must write the register notes and the disclosure. Until then, F-DG7-971 reproduces as before.
- **The rule was not executed against the QA fixture by me.** The S4/S6/S7 values were worked through by hand on the evidence:
  - key `…:2026-11-16T08:00`, `M = 08:00Z`;
  - `*/15` in Asia/Riyadh, so `s = M`;
  - D7 about 07:59:3xZ and the recheck at about 08:00:5xZ, so `s` is in the window;
  - `created_at` 08:00:52.8Z.

  T-S4 makes this executable.
- **Interpretation to confirm.** S6's one-minute key latency and S7's 60 s lower margin before `W0` are my exact reading of D-278's "slot inside the D7-D9 window, per that schedule's cron". They come from pg-boss 11.0.0's code (A5.3), not from D-278's text. If the orchestrator reads D-278 more narrowly (`M` must itself be a slot, and `W0 ≤ s`), a catch-up near D7's start or the D9 restart can still FAIL. That narrower reading would keep part of F-DG7-971.

## 5. Merge instructions

- Documentation only, with no migration, no ordering constraint and no contract change.
- One ADR file is appended and one paragraph in its A3.9 is annotated, so conflicts are expected only if another task edits ADR-0064 A3.9 or appends after A4.10 at the same time.
- DO's and AN's D-278 repairs must follow this merge, because they implement A5.

## 6. Residual risks

From A5.7:
1. A scheduled handler that writes business rows in the window still FAILs D9. This is intended and disclosed. On the demo, QA measured `selected 0`.
2. Engine ticks (`automation.tick_hourly` and `tick_daily`) key their executions by hour or day start, not by a cron occurrence, so they are not covered. The demo seeds no tick rule.
3. The rule depends on pg-boss 11.0.0's cron timing (an ADR-0068 upgrade item).
4. A failure-queue retry of an earlier slot stays unexplained.
5. The stage parses the console text, so a text drift can only make it stricter.

## 7. Open questions (for the orchestrator)

1. **The S6 and S7 latitude.** Do you accept that "a slot inside the window" includes the pg-boss catch-up (a slot up to 60 s before `W0`) and a key minute one minute after the slot? If not, A5 needs a narrowing note, and F-DG7-971 is only partly repaired.
2. **Engine ticks.** Should they be covered as well? That would be a separate decision: their keys name an hour or day start, not a cron slot. D-278 as written does not cover them.
3. **Harness re-check.** A5.5 has the harness re-check S2–S8 from the report alone. Is that enough for QA, or must the harness also query the kept target database (the drill deletes it unless `--keep` is given)?
4. **Task id reuse.** Should this handback move to its own id and path, for example `T-DG7-ARCH-R8`? I kept the 2026-11-14 handback verbatim below mine rather than guess.

---

# Earlier handback with the same task id (2026-11-14, integrated in `3386b9092`, D-266): preserved verbatim below

# Handback T-DG7-ARCH-R6: ADR-0069 §5 launcher amendment (solution-architect)

- **Stage:** P7, gate DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `HEAD` `85f6ebe9fb6b7136bd3cbb1670400be449b8dfc8`. The tree was clean apart from two `runs/` directories: this run's, and QA-C's from a parallel run.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-ARCH-R6.md` (sha256 `37916ead…3efdd`, verified).
- **Invocation:** `DG7-T-DG7-ARCH-R6-solution-architect-20261114T131339Z-a0fbc6f1`, session `a0fbc6f1-ea14-4d2d-9e4a-225b2cd9ae5e`.
- **Time:** start `2026-11-14T13:17:56Z`. Checks ended at about 13:40Z (`date -u`).
- **Evidence:** `docs/delivery/handbacks/DG7/T-DG7-ARCH-R6-evidence/`.
- **Scope:** documentation only. No code, migration, contract, permission or advisory-lock change.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `docs/architecture/adr/ADR-0069-p7-clean-deployment-base-url-readiness-transfer-offline-image-drills.md` | Adds **Amendment 1**: A1.1 (Q1), A1.2 (Q2), A1.3 (Q3) and A1.4 (residuals 8–9). §5's first sentence and §6's `save` bullet are edited in place, each with a pointer to the amendment, and §6 gains an "Image store" bullet. |
| `docs/architecture/p7-work-split.md` | §B.3: the offline drill line now cites A1.1. §B.4 T-B12: the image set is the Compose-run set plus `excluded`, and there is a classic-store exit 3 case. §B.5: one new `image-bundle.sh` exit 3 line. |
| `docs/delivery/handbacks/DG7/T-DG7-ARCH-R6-solution-architect.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-ARCH-R6-evidence/*` | Check logs, plus `docs.diff` (the diff of the two documents, taken before this handback was written). |

## 2. Behaviour per requirement / question

| Item | Decision | Where |
| --- | --- | --- |
| DO-E **Q1** (REQ-S19-018 first half, REQ-S01-006) | **The ADR changes; the drill does not.** The specs run on the stacks their headers name (`with-demo-stack.sh` or `with-stack.sh`). Both stacks start a disposable cluster and the built API serving the built SPA inside the namespace. `ci-e2e-stack.mjs` needs an already running PostgreSQL service (`TEST_DATABASE_ADMIN_URL`), seeds only `seed-dev` and starts one API on `:3000`, so it cannot serve the drill. It stays the CI launcher (ADR-0012). The header-grep grouping is disclosed: a mis-grouped spec fails and never passes falsely. | ADR-0069 §5, A1.1; work-split §B.3 |
| DO-E **Q2** (REQ-S19-018 second half) | The **containerd image store is a precondition** on the load host. `docker info` must show `overlayfs` with driver-type `io.containerd.snapshotter.v1`. On a classic-store host the clause is **BLOCKED** and becomes a release blocker (REQ-S21-003). The orchestrator may switch the store and rerun from step 1. **No re-tagging and no rewritten `image:` lines**, because either would drop the digest pin at start time. | ADR-0069 §6, A1.2; work-split §B.4 T-B12, §B.5 |
| DO-E **Q3** | `save` bundles the lock images that a Compose file runs, plus the app image. On the current lock that is `postgres`, `keycloak` and `mth-app`. The Playwright image (CI-only) and `node-runtime` (its layers travel inside `mth-app`) are listed in a new optional `images.json` key, `excluded`. `mth-image-bundle/1` stays valid because the key is optional. | ADR-0069 §6, A1.3; work-split §B.4 T-B12 |
| `apps/api/test/support/p7-pending*.ts` | No entry belongs to this task, so nothing was removed. | — |

Authorization, validation, concurrency, audit, money, Unknown/Stale and bilingual rules: not applicable. There is no product change.

## 3. Checks run (real exit codes)

Node 24.21.0 (`PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH`), `MTH_PNPM_OFFLINE=1`.

| Command | Exit | Result / log |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG6` | 0 | `PASS gate DG6 (historical)` (`validate-historical-DG6.log`). **Order:** it ran after the documents were edited, not before. |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` (`openapi-lint.log`) |
| `pnpm lint` | 0 | `lint.log` |
| `pnpm -r typecheck` | 0 | `typecheck.log` |
| `pnpm test` | 0 | Test files 205 + 130 + 3; tests 3022 + 2175 + 259 passed, 2 skipped (`pnpm-test.log`), 13:30–13:38Z |
| `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | 0 | 111 of 111 (`contract-test.log`). No integration test was touched. |
| `npx prettier --write` on the two edited documents | 0 | Formatting only |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | 23 batches, all "All matched files use Prettier code style!", no `[warn]` (`prettier-repo.log`), 13:42Z, after this handback was written and formatted. This row's own edit was re-checked (next row). |
| `npx prettier --check` on this handback after its last edit | 0 | "All matched files use Prettier code style!" |

Not run: the Docker behaviour in A1.2. The sandbox has no network and no Docker daemon (D-243 Q1), so that check is **BLOCKED** here.

## 4. Known gaps

1. **A1.2 is not verified against official Docker documentation or by a run.** The sandbox is offline and has no daemon. Two points rest on the engine's store model as I know it:
   - the classic store loses `RepoDigests` on `load`;
   - the containerd store keeps the digest after `load`.

   M0314 evidence for this is **pending** (ADR residual 8). The orchestrator's host run decides, and a contrary result reopens A1.2.
2. **Code follow-ups for DO-E are not done** (documentation-only task):
   - (a) `image-bundle.sh load|verify` detects the classic store and exits 3 with the §B.5 line (A1.2 item 4);
   - (b) `save` selects the Compose-run images and writes `excluded` (A1.3 item 5);
   - (c) the matching T-B12 cases.

   Until they land, the shipped script saves every lock image, so step 1 must pull Playwright. The bundle is larger but correct. A classic store shows up as an exit 1 `(present)` mismatch rather than exit 3. **T-B12 as amended in §B.4 is not met by the shipped tests yet.**
3. **"You run alone" did not hold.** A QA-C run (`DG7-T-DG7-QA-C-qa-verifier-20261114T131344Z-23c9a774`) worked in the same tree during this task. At the end, `git status` shows changes that are **not mine**:
   - `tests/qa/integration/a19-backup-restore-drill.test.ts`, `a22-operational-readiness.test.ts` and `a22-p6-operability.test.ts`;
   - `docs/delivery/test-evidence/DG7/qa/T-DG7-QA-C/`.

   My checks (`pnpm test`, the contract test, lint, typecheck, Prettier) ran on a tree that may already have held some of those edits. I did not touch them. Commit only the files of §1 for this task.
4. `docs/operations/restricted-network.md` (DO-E's file) still describes the bundle as holding "the four images". It should follow A1.3 when follow-up (b) lands. I did not edit it, because it is outside this assignment.

## 5. Open questions

- **Q-R6-1 (orchestrator):** should follow-ups 2(a)–(c) be a DO-E repair task before the freeze? Or should the host run go ahead on the shipped script, with the orchestrator's `docker info` record standing in for (a)?
- **Q-R6-2 (orchestrator):** the T-B12 wording in §B.4 now runs ahead of the shipped tests. If the follow-up is deferred, should T-B12 be marked partially met in the register's evidence?

## Merge instructions

Documentation only. Merge the two documents and this handback. No migration, no contract change, and no conflicts expected.
