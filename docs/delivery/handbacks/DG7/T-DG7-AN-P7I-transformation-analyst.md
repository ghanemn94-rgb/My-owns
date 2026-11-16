# Handback T-DG7-AN-P7I (transformation-analyst): the D-278 transfer-drill disclosure in the handover surfaces (F-DG7-923, F-DG7-942, F-DG7-972)

- **Stage:** DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `HEAD` `52db1450d73c09a5778e0bcef98c89bf214b6f08`, checked with `git rev-parse HEAD`. At the start, `git status` was clean apart from this run's own `docs/delivery/runs/…` directory.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-AN-P7I.md`, sha256 `99d99d47…0f1145` (checked).
- **Invocation:** run `DG7-T-DG7-AN-P7I-transformation-analyst-20261116T153010Z-1af3dcb1`, session `1af3dcb1-1692-42b8-bd88-ca5de1999607`.
- **Requirements:** REQ-S19-017, REQ-S20-018 and REQ-S01-006. Findings F-DG7-923, F-DG7-942 and F-DG7-972 (all Low, not mandatory, one gap).
- **Time:** `date -u` start 15:30:22Z, end 15:51Z (about 21 minutes).
- **Two gate systems.** This is documentation only. It grants and implies no G1–G6, Finance or IT approval, and no DG gate. I close none of the three findings: only a non-author reviewer can. All drill data cited is SYNTHETIC.

**Inputs read:**
- ADR-0064 Amendment 5 (A5.1–A5.7) in full;
- the three findings in `findings.json`;
- the T-DG7-AN-P7H handback;
- `p7-work-split.md` §1–§2;
- `tools/release/known-limitations.mjs`, `release-notes.mjs` and the summary check of `check-handover.mjs`;
- `docs/handover/known-limitations.md`, `deployment.md` (the drill paragraph, l.247), both Arabic summaries and `arabic-review.json` (`[]`, so every Arabic text is provisional).

I checked the job codes and the pg-boss version in the source:
- `approval.escalation_scan`, `kpi.reporting_period_open`, `automation.tick_hourly` (`'7 * * * *'`) and `automation.tick_daily` (`'20 0 * * *'`) in `packages/db/migrations/*.sql`;
- `pg-boss` `11.0.0` in `apps/worker/package.json`.

## Blocking fact: the write scope does not include the handover files

The assignment asks me to edit the handover sources and regenerate with `--write`. My write scope (`tools/agents/write-scopes.json`, `transformation-analyst`) allows only:
- `docs/analysis/**`;
- `docs/delivery/requirements.csv`;
- `docs/delivery/handbacks/**`.

The sandbox enforces this. `touch docs/handover/.wtest` gave `Read-only file system`, while `docs/analysis/` was writable. So I cannot change any file under `docs/handover/**`, and I cannot run either generator with `--write`, because both write there.

**What I delivered instead:** the exact disclosure text, as a script the orchestrator can apply mechanically. I applied it in a disposable copy and verified it there (§3).

## 1. Files changed

| File | Purpose |
| --- | --- |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7I-transformation-analyst.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7I-evidence/apply-d278-disclosure.mjs` (sha256 `5830ff69…bc309`) | Ready-to-apply edit of four hand-written handover files. It is anchored on exact existing lines. It exits 2 and writes nothing if an anchor is missing or the text is already present. |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7I-evidence/d278-disclosure.diff` (sha256 `74c2cc5d…e036d`) | The resulting unified diff against `HEAD`, after prettier. Review it before applying. |
| `docs/delivery/handbacks/DG7/T-DG7-AN-P7I-evidence/*.log` | Check logs (§3). |

**Not changed:**
- `docs/handover/**`: read-only to me (see above).
- `docs/delivery/requirements.csv`. The notes of the three rows already carry the A5.6 points and A5.7 residuals 3–4 (AN-P7H, "analyst pass 8"). Editing the register would also change its SHA-256, which `release-notes.md` embeds. `release-notes.mjs --check` would then fail until someone regenerates it, and I cannot regenerate it.
- `tools/**`, `docs/source/**`, `.claude/**`, reviews, gate records, code and tests.

No `apps/api/test/support/p7-pending*.ts` entry belongs to this task. The generic deliverables (mutations, authorization, decimal, bilingual UI) don't apply, because there is no product change.

## 2. Behaviour per requirement

The text, once applied (`d278-disclosure.diff`):

| Surface | What is added | Status |
| --- | --- | --- |
| `known-limitations.md` §6 (hand-written) | A new row, **ADR-0064 Amendment 5 (D-278)**, after the ADR-0064 row. It states (1) a scheduled job running in the D7–D9 window is explained only as A5.2 says: an added `automation_execution` with no initiating user and a `schedule` trigger, whose `trigger_key` names an enabled `job_schedule` row in the target and a slot of that row's cron and timezone inside the window, created in the window with its worker audit event, one per slot, plus its action results and audit events. Each one is listed in `schedule-explained-d9.json` and in the D9 `recheck`/`scheduleExplained`/`scheduleWindow` fields. Every other added or changed row stays unexplained. (2) A scheduled handler that writes business rows in the window still makes D9 fail (examples: `approval.escalation_scan` escalating, `kpi.reporting_period_open` opening a period, A5.7 residual 1), which is not a data defect. (3) The recovery is to re-run the drill, never to pause or reschedule a job. It also names **A5.7 residual 3** (engine ticks not covered, why, none written by the demo today, not decided in this release) and **residual 4** (pg-boss 11.0.0 timing, an ADR-0068 upgrade item). `D-278` is added to Sources. | Ready, **not applied** |
| `deployment.md` drill section | That section already carried points (1)–(3) (l.247). A new paragraph adds A5.7 residuals 3 and 4 and links to `known-limitations.md#adr-residuals`. | Ready, **not applied** |
| `known-limitations.ar-summary.md` | Steps item 7 (provisional Arabic): the rule, the report, the D9 failure on handler writes that is not a data defect, re-run never pause or reschedule, the ticks not covered, and pg-boss 11.0.0. | Ready, **not applied** |
| `deployment.ar-summary.md` | One paragraph (provisional Arabic) after the migration paragraph, with the same points. | Ready, **not applied** |
| `release-notes.md` (generated) | **Nothing possible without a tool change** (§4 gap 2). | **Gap** |

Per requirement:
- **REQ-S19-017** (A18 drill): the drill behaviour is unchanged. Once applied, the patch completes the handover disclosure that ADR-0064 A5.6 requires, except in the release notes. Status stays **IMPLEMENTED**, and I did not edit the register.
- **REQ-S20-018** (A18 executable test): same as REQ-S19-017. No change to the row.
- **REQ-S01-006** (transferable package): the deployment guide and known limitations given to IT will carry the rule and its residuals once applied. No change to the row.

Until the patch is applied, F-DG7-923, F-DG7-942 and F-DG7-972 remain unrepaired in the repository.

## 3. Checks run (real exit codes)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, no network, no Docker, analyst sandbox. Logs are in `docs/delivery/handbacks/DG7/T-DG7-AN-P7I-evidence/`.

**In the repository at `HEAD` (no handover change):**

| Command | Exit | Result / log |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG6` | 0 | `PASS gate DG6 (historical)` (`validate-historical-DG6.log`) |
| `node tools/release/release-notes.mjs --csv docs/delivery/requirements.csv --deps docs/handover/external-dependencies.json --provisional apps/web/src/i18n --out docs/handover/release-notes.md --check` | 0 | up to date (`release-notes-check-head.log`) |
| `node tools/release/check-handover.mjs --protocol-audit docs/delivery/test-evidence/DG7/orchestrator/protocol-audit/protocol-audit-r6.json` | 0 | all six checks PASS, 8 pre-existing warnings (`check-handover-head.log`). Without `--protocol-audit` it exits 2 (BLOCKED `generated`), so I re-ran it with the r6 report. That is the only orchestrator report for which `known-limitations --check` exits 0; prefreeze, r3 and r4 exit 1. |
| `pnpm -r typecheck` | 0 | `typecheck.log` |
| `pnpm lint` | 0 | `lint.log` |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` |
| `pnpm test` | **1: BLOCKED by the sandbox, not a test failure** | `EROFS: read-only file system, open '…/node_modules/.vite-temp/vitest.config.ts.timestamp-…mjs'`. No test ran (`pnpm-test.log`). |
| The three `pnpm test` projects, each as `QA_EVIDENCE_DIR=$TMPDIR/qa-a20 npx vitest run --configLoader runner --project <p>` | 0, 0, 0 | unit-node: 207 files, 3042 tests passed. unit-web: 131 files, 2199 tests passed. unit-formula-nocodegen: 259 passed, 2 skipped (`vitest-*.log`). |
| `git ls-files -co --exclude-standard -z \| xargs -0 node_modules/.bin/prettier --check --ignore-unknown` (prettier 3.8.1; `npx prettier` tried the registry offline) | 0 | 25 batches, all matched, no `[warn]` (`prettier.log`). It ran before this handback was written. The handback is checked on its own below. |
| Integration tests and the contract test on `with-pg.sh` | **NOT RUN, not applicable** | No code, test or contract changed. |

**In a disposable copy:** `git archive HEAD` of the paths the handover tools read, extracted into `$TMPDIR/v` and deleted afterwards. In it I ran `apply-d278-disclosure.mjs --root $TMPDIR/v`, then prettier. Log: `verify-copy-checks.log`.

| Command | Exit | Result |
| --- | --- | --- |
| `apply-d278-disclosure.mjs --root <copy>` | 0 | wrote 4 files. A second run exits 2 ("already carries the text"). The prettier-formatted script, re-run on fresh copies of the four files, gives byte-identical output (`cmp`). |
| `prettier --check` (then `--write`) on the four files | 0 | already formatted, no change |
| `known-limitations.mjs --protocol-audit …/protocol-audit-r6.json --check` | 0 | PASS: the new row is outside the generated blocks |
| `release-notes.mjs … --check` | 0 | up to date (the register is unchanged) |
| `check-handover.mjs --root . --only index,deployment,summaries,security-links,guides` | 0 | all PASS, the same 8 pre-existing warnings |
| `claims-scan.mjs --root <dir with the 4 patched files>` | 0 | `PASS (4 files)` (`claims-scan-patched.log`) |
| `check-handover` `generated` in the copy | **BLOCKED (exit 2)** | `role-matrix.mjs` and `automation-jobs.mjs` need the installed workspace, which the partial copy lacks. Those generators don't read the four files. In the repository they PASS. |

## 4. Known gaps / not done

1. **No handover file is changed in the repository.** The write scope and the sandbox forbid `docs/handover/**`, so the three findings are not yet repaired. Someone with write access must run the script (§5).
2. **The release notes cannot carry the disclosure without a code change.** For IMPLEMENTED rows, `release-notes.mjs` copies register text only in two places:
   - the `completes-after-gate:` clause, which means "completes after DG7". Using it here would be untrue.
   - the notes of unfinished rows. The three rows are IMPLEMENTED.

   Its other inputs (`external-dependencies.json`, identity, provisional files) are not suitable. So A5.6's "the release notes" surface needs one of:
   - (a) a `tools/release/release-notes.mjs` change that I may not make, for example a fixed "Known limitations" pointer section or a quoted D-278 paragraph (owner DO or the orchestrator, with a test);
   - (b) a recorded orchestrator decision, as F-DG7-942 itself suggests, that `known-limitations.md` and `deployment.md` satisfy A5.6 for this release.
3. **`requirements.csv` is not edited**, for the SHA reason in §1. The register notes already carry the rule.
4. **Arabic is provisional.** `arabic-review.json` is `[]`. No qualified Arabic reviewer has checked it, which is an external dependency.
5. **Literal `pnpm test` is BLOCKED** in this sandbox (EROFS). The equivalent per-project runs passed.

## 5. Open questions and merge instructions

**Open questions (for the orchestrator):**
1. Will you apply the patch, or reassign it to a role that can write `docs/handover/**`? Steps:
   - `node docs/delivery/handbacks/DG7/T-DG7-AN-P7I-evidence/apply-d278-disclosure.mjs`
   - `node_modules/.bin/prettier --write` on the four files
   - `known-limitations.mjs --protocol-audit <freeze report> --check`
   - `release-notes.mjs … --check`
   - `check-handover.mjs --protocol-audit <freeze report>` (exit 0 expected)
2. For the release notes: (a) a tool change, or (b) a recorded decision (§4 gap 2)?
3. Engine ticks (A5.7 residual 3) are still undecided. The text says "not decided in this release". If you decide them, the row needs updating.

**Merge:**
- Documentation only: no migration, no ordering constraint, no contract change.
- The script refuses to run if another task has changed the anchor lines (the §6 ADR-0064 row, the Sources lines, `deployment.md` l.247, Arabic item 6, the Arabic migration paragraph). In that case, apply `d278-disclosure.diff` by hand.
