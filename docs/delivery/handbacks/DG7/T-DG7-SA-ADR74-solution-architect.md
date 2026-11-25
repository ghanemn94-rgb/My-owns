# Handback T-DG7-SA-ADR74 (solution-architect): ADR-0066 Amendment 3 for DO-D14 (F-DG7-1091, F-DG7-1102)

- **Stage:** DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`. Base `HEAD` `3f48bd28b10d4696281430727040de537aa8911d` (round-4 candidate source `2fd69c3753ffb1f96aaf787f8526daa0bf59abe7`).
- **Invocation:** run `DG7-T-DG7-SA-ADR74-solution-architect-20261125T101752Z-1451e441`, session `1451e441-73e2-41ec-ad79-45e88642922e`.
- **Time:** started `2026-11-25T10:18:06Z` (`date -u`). The end time is at the end of §3.
- **Findings addressed:** F-DG7-1091 (domain, Low) and F-DG7-1102 (code-security, Low), the ADR half only. The `backup-restore.md` §8 half of F-DG7-1102 (and F-DG7-1092) belongs to the devops-engineer (T-DG7-DO-D15). An author never closes their own finding, so both stay open for reviewer verification.
- **Approvals:** this is an engineering document. It approves nothing: no G1–G6 decision, no Finance or IT approval, and no DG7 decision. The drill data it cites is SYNTHETIC.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `docs/architecture/adr/ADR-0066-p7-backup-restore-backup-set-manifest-restore-checks-drill.md` | **Appended Amendment 3 (2026-11-25):** A3.1 the `.backup-state` config listing and the finish-phase refusals; A3.2 `--evidence-owner`, the default owner, §7 step 5's hand-over and modes, and the R7 row with `owner`, `otherOwner` and `groupOrOtherBits`; A3.3 the symbolic-link evidence root rule that DO-D15 builds; A3.4 A2.6 restated from rg4, rg4b and rg4c; A3.5 A2.7 items 1 to 3 are now behaviour; A3.6 residual 9 corrected and residual 11 added (with the answer to DO-D14 Q3). **Five one-line pointers** in the replaced places: §7 step 5, the §8 R7 row, the head of A2.6, the last paragraph of A2.7 and residual 9 of A2.8. No other text changed. |
| `docs/delivery/handbacks/DG7/T-DG7-SA-ADR74-solution-architect.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-SA-ADR74-evidence/*.log` | Logs 01 to 08 (§3). |

No code, test, guide, migration, OpenAPI contract, image lock or dependency was changed. No `p7-pending*.ts` entry names these findings (this is an ADR task), so none was removed.

## 2. Behaviour per requirement

**REQ-S19-012 and REQ-S20-019 (ADR-0066; "ADR claims enumerated and exactly true", p7-work-split §2 rule 2).**

- **The DO-D14 rules as built, each checked against the code at the base:**
  - A3.1: `backup_config_listing` and `.backup-state/config.sha` + `config_sha256` (`backup.sh` l.446–465); the four finish-phase reasons, quoted from `backup.sh` l.557–564; `.backup-state` removed on success (l.645).
  - A3.2: `--evidence-owner` validation (`restore.sh` l.67–70); the default owner (l.136–141); the step-5 `chown -R` condition and the 0700/0600 modes, with their R7 failure lines (l.173–184); and R7's expected and actual JSON (l.235–241).
  - Tests named by id: T-E11, T-E11b, T-E14, T-E14b, T-E14c, and the two new `backup-compose-layout.vitest.mjs` tests. The amendment says that T-E14c is skipped where uid 10001 cannot be expressed, and that two of the four finish-phase reasons have no test of their own.
- **A2.6 restated (A3.4)** from the rg4, rg4b and rg4c logs:
  - the source commit of each run, its result and the failing step with its D-285 cause;
  - rg4c's C2b to C10 facts: 2 objects and 146 bytes copied out under `DAC_READ_SEARCH`, 3 `config.files`, no stderr, the R1 to R8 actuals, R7 owner `10001:10001`, the report's step timings, the 1 queued job on the target, and `/readyz` ready;
  - an explicit list of what rg4c does not show.
- **Residual 9 corrected (A3.6).** It no longer says zero items moved. It names what remains unshown in Compose.
- **A2.7 items 1 to 3 are behaviour (A3.5),** with the one exception of F-DG7-1101.
- **The symbolic-link evidence root rule (A3.3).** The root is resolved once, before step 4, to its target, as A1.3 item 3 does for the backup root. Every later use takes the resolved path. A dangling link or a non-directory is refused with exit 2 before step 4. The rule is marked **not built at this base**: DO-D15 builds it with T-E15. If DO-D15 is not merged, the rule is open.
- **DO-D14 §5 Q3 answered (A3.6 residual 11).** A precondition the script can test before step 4 should be refused there. For a non-root runner whose account differs from the evidence owner, this check is **not built and not assigned**, and it stays a disclosed residual.

## 3. Checks run (real exit codes)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, bubblewrap sandbox, Linux 6.18.44. **The tree was shared with a concurrent T-DG7-DO-D15 run.** Its uncommitted edits to `deploy/scripts/restore.sh` and `deploy/scripts/tests/backup-restore.test.mjs` were present while my checks ran (see §4 gap 1).

| # | Command | Exit | Result / tail | Log |
| --- | --- | --- | --- | --- |
| 1 | `node tools/gates/validate.mjs --historical --stage DG6` | 0 | `PASS gate DG6 (historical)` | `01-validate-dg6.log` |
| 2 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (10:21 Z) | **123** | One file failed: `[warn] deploy/scripts/tests/backup-restore.test.mjs`, DO-D15's in-progress edit and not mine. Every other batch: `All matched files use Prettier code style!` | `02-prettier.log` |
| 2b | the same command, rerun at 11:01 Z after DO-D15 had written its handback | **0** | no `[warn]` line in any batch | `02b-prettier-rerun.log` |
| 3 | `npx prettier --check docs/architecture/adr/ADR-0066-…md` | 0 | `All matched files use Prettier code style!` | `03-prettier-adr.log` |
| 4 | `pnpm -r typecheck` / `pnpm lint` / `pnpm openapi:lint` | 0 / 0 / 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` | `04-typecheck.log`, `04-lint.log`, `04-openapi.log` |
| 5a | `pnpm test` (first attempt) | none | **Stopped by the runner's 600 s background limit** that I set too low. No test had failed when it stopped. Not counted as a result. | `05a-pnpm-test-killed-at-600s.log` |
| 5 | `pnpm test` (rerun, 10:46 to 10:56 Z) | **0** | `208 files / 3056 tests passed`; `131 / 2199 passed`; `3 files / 259 passed, 2 skipped` (pre-existing skips in `fuzz.test.ts`) | `05-pnpm-test.log` |
| 6 | `node tools/release/claims-scan.mjs` (ADR-0063 T-G6 wording) | 0 | `claims-scan: PASS (891 files; D 141, U 750; negated 28; allowed 19)` | `06-claims-scan.log` |
| 7 | `node tools/release/secret-scan.mjs` | 0 | `secret-scan: PASS (payload; 3160 files; allowed 33; canary (documented) 22)` | `07-secret-scan.log` |
| 8 | `QA_PG_PORT=31431 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | **0** | `Test Files 1 passed (1)`, `Tests 111 passed (111)` | `08-contract-test.log` |

The claims about the code in Amendment 3 were checked by reading `restore.sh` and `backup.sh` at `HEAD` (`git show HEAD:…`), not the working tree, so DO-D15's in-progress edits do not affect them. `git diff --stat 389482803 HEAD -- deploy/scripts/backup.sh deploy/scripts/restore.sh apps/ deploy/docker deploy/compose` printed nothing, so rg4c ran the same product code as the candidate.

Checks 4 to 8 ran on the shared tree, with DO-D15's uncommitted edits to `restore.sh`, `backup-restore.test.mjs` and `backup-restore.md` present. They therefore show the combined tree, not my change alone. My change is one Markdown file and cannot affect typecheck, lint, the OpenAPI lint or the tests. No test I own exists for an ADR. The integration tests: I touched none. The contract test ran as the assignment asks (check 8).

**End:** `2026-11-25T11:02Z` (`date -u`; about 44 minutes).

## 4. Known gaps / not done

1. **The tree was not mine alone.** The assignment says "You run alone", but T-DG7-DO-D15 was launched at the same second (`…20261125T101752Z…`) in the same working tree. This is the same situation as SA-ADR73 §4 gap 1. Checks 2 and 4 to 8 ran on the combined tree. Check 2 failed once on DO-D15's in-progress file and passed on the rerun (2b).
2. **A3.3 and residual 11 describe DO-D15's change as not built.** At my base it is not built. Its uncommitted diff, which I read at 11:01 Z, matches A3.3 items 1 to 3:
   - `readlink -e` once, before step 4;
   - `stat -L`;
   - a dangling link or a link to a non-directory refused with exit 2 before the database is touched.

   It also adds the non-root refusal that residual 11 asks for (T-E15d). Its messages differ from any I might have guessed, which is why A3.3 does not quote messages. **After DO-D15 merges, a short further amendment (or an orchestrator decision) should record the messages and T-E15a to T-E15d as built, and close residual 11.** I did not write that amendment, because the ADR must not claim behaviour of unmerged code.
3. **The `backup-restore.md` §8 half of F-DG7-1102** (and F-DG7-1092) is DO-D15's. I did not touch the guide.
4. **A small observation outside my scope.** The usage line of `restore.sh` (l.63–64 at the base) does not list `--evidence-owner`, but the header comment does. The ADR does not claim the usage line lists it.
5. **A2.4's offline-unverified seccomp facts** (SA-ADR73 §4 gap 2) are unchanged. This sandbox is offline too.

## 5. Open questions

1. **Orchestrator:** after DO-D15 is merged, assign the follow-up amendment of gap 2, or record a decision that A3.3 plus DO-D15's handback is enough.
2. **Orchestrator:** a discrepancy in the evidence. `compose-backup-rg4b/run.txt` records `source_commit b2864f2…`, but that run's drill log C0 says `repository HEAD 389482803…`. A3.4 cites the log and names both. rg4c ran on `389482803` plus the drill's `smoke.mjs` seeding, which was committed only after the run (`9b3547113`, 11:57:46 Z; the run ended 11:57:34 Z). A3.4 states this from D-285 and the commit order.
3. **Orchestrator (repeat of SA-ADR73 Q3):** please run documents-only tasks without a concurrent implementer in the same tree, or in their own worktree.

## Merge instructions

Documents only: no migration and no ordering constraint. The ADR edit touches only ADR-0066, which DO-D15 does not own. Merge in either order with DO-D15. If DO-D15 is merged, gap 2 applies.
