# Handback T-DG7-DO-D10 (devops-engineer): the D-278 disclosure in the handover surfaces and the release notes (F-DG7-923, F-DG7-942, F-DG7-972)

- **Stage:** DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `HEAD` `f1acfe4ce033580dab36160ef43dbb4ecbb19af3`, checked with `git rev-parse HEAD`. At the start, `git status` was clean apart from this run's own `docs/delivery/runs/…` directory.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DO-D10.md`, sha256 `93216e55…ef1c0` (checked).
- **Invocation:** run `DG7-T-DG7-DO-D10-devops-engineer-20261116T155341Z-f723e7f8`, session `f723e7f8-9e9a-4dbb-acfb-5d7bb84d54c5`.
- **Requirements:** REQ-S19-017, REQ-S20-018 and REQ-S01-006. Findings F-DG7-923, F-DG7-942 and F-DG7-972 (all Low, not mandatory).
- **Time:** `date -u` start 15:53:50Z, end 16:36Z (about 43 minutes).
- **Two gate systems.** This change is documentation and release tooling only. It grants and implies no G1–G6, Finance or IT approval, and no DG gate. I close none of the three findings: only a non-author reviewer can. All drill data cited is SYNTHETIC.
- **Environment.** Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, prettier 3.8.1 (`node_modules/.bin/prettier`), no network and no Docker daemon (D-243 Q1). HOME is read-only, including `/root/.local/share/pnpm/store`.

**Inputs read:**
- the assignment;
- `CLAUDE.md` and `agent-protocol.md`;
- `p7-work-split.md` §1–§2;
- ADR-0064 Amendment 5 A5.6–A5.7, and ADR-0071 §5;
- decisions D-278 and D-279;
- the T-DG7-AN-P7I handback and its `apply-d278-disclosure.mjs` (sha256 `5830ff69…bc309`) and `d278-disclosure.diff` (sha256 `74c2cc5d…e036d`);
- `tools/release/release-notes.mjs` and its test;
- the `check-handover.mjs` summaries rule.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `docs/handover/known-limitations.md` | The analyst's §6 row **ADR-0064 Amendment 5 (D-278)**, plus `D-278` in Sources. Applied by the analyst's script, verbatim. |
| `docs/handover/deployment.md` | The analyst's paragraph after the drill paragraph (A5.7 residuals 3 and 4, with a link to `known-limitations.md#adr-residuals`). Verbatim. |
| `docs/handover/known-limitations.ar-summary.md` | The analyst's item 7 (provisional Arabic). Verbatim. |
| `docs/handover/deployment.ar-summary.md` | The analyst's drill paragraph (provisional Arabic). Verbatim. |
| `tools/release/release-notes-disclosures.json` (new) | The checked-in input: format `mth-release-notes-disclosures/1`, one entry `d278-transfer-drill`. It holds the English and Arabic heading, five lines in each language and the link `known-limitations.md#adr-residuals`. |
| `tools/release/release-notes.mjs` | Reads that file from its own directory, with an optional `--disclosures <file>` override. `parseDisclosures` validates it strictly. A new section "Known limitations disclosed in this release" goes between the dependencies and the provisional-Arabic sections, with an Arabic counterpart in the RTL summary. A missing or invalid input exits 2 (BLOCKED) and writes nothing. |
| `tools/release/tests/release-notes.test.mjs` | Five new `node --test` tests (DO-D10). |
| `docs/handover/release-notes.md` (generated) | Regenerated with `--write`: +30 lines (the English section and the Arabic subsection). The register SHA and every other section are unchanged. |
| `docs/handover/README.md` | The index line for `release-notes.md` now names the new section and its input file. |
| `docs/delivery/handbacks/DG7/T-DG7-DO-D10-devops-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-DO-D10-evidence/*.log` | Logs of every check in §3. |

**SHA-256 after the change:**

| File | SHA-256 |
| --- | --- |
| `release-notes.mjs` | `16688ce1…a0e50d` |
| `release-notes-disclosures.json` | `2d109f8e…aef47e` |
| `release-notes.test.mjs` | `1b20cfbc…c010b6` |
| `release-notes.md` | `24699425…a28911` (158 lines) |
| `known-limitations.md` | `9d830b68…da7dfe` |
| `deployment.md` | `fe1d1f2f…4dbeb9` |
| `known-limitations.ar-summary.md` | `b9c3b4d0…a3b5c2` |
| `deployment.ar-summary.md` | `7e6271ff…11901c` |
| `README.md` | `dff36058…f3db1a` |

**Not changed:**
- `docs/delivery/requirements.csv`, so the register SHA in the release notes is unchanged;
- `apps/**` and `packages/**`;
- no `apps/api/test/support/p7-pending*.ts` entry belongs to this task (`grep` for `D-278|D10|disclos` finds none);
- `tools/gates/**`, `tools/agents/**`, `.claude/**`, `docs/source/**`, reviews, gate records, `stages.json`, `findings.json`, `test-evidence/**`.

## 2. Behaviour per requirement

**(1) Handover surfaces (A5.6 AN).**
- `node docs/delivery/handbacks/DG7/T-DG7-AN-P7I-evidence/apply-d278-disclosure.mjs` wrote 4 files (exit 0). `prettier --write` on the four changed nothing material (exit 0).
- A second run refuses with exit 2 ("already carries the text").
- **Verbatim check:** for each of the four files, the SHA-256 of the added and removed lines of `git diff` equals that of the analyst's `d278-disclosure.diff`. The four values are `6fbb83c9…`, `5cbed000…`, `42fdc56c…` and `878677ed…`, all SAME (`apply-disclosure.log`). The anchors had not moved, so no hand edit was needed.

**(2) Release notes (A5.6 "the release notes"; the analyst's §4 gap 2, option (a)).** The generated `release-notes.md` now carries, for IMPLEMENTED rows and with no register note, the section "Known limitations disclosed in this release". It contains:
- an intro line;
- `### Transfer drill and scheduled jobs (ADR-0064 Amendment 5, D-278)`;
- five lines, which state:
  - scheduled jobs keep running, and the drill never pauses, disables or reschedules one;
  - D9 explains only the A5.2 scheduled executions, which are listed in the drill report (`schedule-explained-d9.json`), and every other added or changed row stays unexplained;
  - a handler that writes business rows in the window still makes D9 fail, which is not a data defect;
  - the recovery is to re-run the drill, never to pause or reschedule a job;
  - the engine ticks `automation.tick_hourly` and `automation.tick_daily` are not covered (A5.7 residual 3), and the window bounds rest on pg-boss 11.0.0's defaults (residual 4);
- a "Details" line linking `known-limitations.md#adr-residuals`, with its source (ADR-0064 Amendment 5 A5.6, D-278).

The Arabic summary has `### قيود معروفة يفصح عنها هذا الإصدار`, followed by the H.3 provisional lines, then the entry's bold title, the five provisional Arabic lines and the link.

**How the section is built:**
- **Generic.** The tool loops over the entries. It holds no D-278 prose: the heading, intro, "None" and "Details" texts sit in `TEXT`, as before. An empty list prints the "None" line in both languages.
- **Deterministic.** There is no clock and the file order is kept. The existing T-I11 no-clock test (two runs, another TZ, `SOURCE_DATE_EPOCH`) still passes, and it now covers the section.
- **Strictly validated:**
  - the format string;
  - no unknown keys;
  - each id in kebab case and unique;
  - every text one trimmed line;
  - `heading` and `link.text` given as `[English, Arabic]`;
  - `link.href` a relative `.md` path under `docs/handover` with an optional fragment. A URL or `../` is refused.

The Arabic layout is chosen so that `check-handover`'s §2.3 rule adds no warning: the count stays at the 8 pre-existing warnings. My first layout used a `####` Arabic heading and added 2 warnings. I replaced it before the final runs.

**Per requirement:**
- **REQ-S19-017** (A18 drill) and **REQ-S20-018** (A18 executable test): the drill behaviour is unchanged. All four A5.6 surfaces now carry the disclosure: `known-limitations.md`, `deployment.md`, the two Arabic summaries, and the release notes. The rows stay IMPLEMENTED, and the register is not edited.
- **REQ-S01-006** (transferable package): the deployment guide, the known limitations and the release notes given to IT now carry the rule and residuals 3–4.

F-DG7-923, F-DG7-942 and F-DG7-972 are ready for a non-author reviewer's verification. They are not closed.

## 3. Checks run (real exit codes)

All logs are in `docs/delivery/handbacks/DG7/T-DG7-DO-D10-evidence/`. Protocol-audit report: `docs/delivery/test-evidence/DG7/orchestrator/protocol-audit/protocol-audit-r6.json`, sha256 `a495abb3…74e33a`. It is the latest under the orchestrator's scratch evidence, and the one the analyst used. I did not regenerate it.

| Command | Exit | Result / log |
| --- | --- | --- |
| `node …/apply-d278-disclosure.mjs`, then `prettier --write` on the 4 files, then a second run of the script | 0, 0, 2 (expected) | 4 files written; verbatim check SAME ×4 (`apply-disclosure.log`) |
| `node tools/release/release-notes.mjs --csv docs/delivery/requirements.csv --deps docs/handover/external-dependencies.json --provisional apps/web/src/i18n --out docs/handover/release-notes.md --check` (before `--write`) | 1 (expected drift) | "out of date (run with --write)" |
| the same with `--write` | 0 | `0 unfinished item(s), 23 later clause(s); wrote docs/handover/release-notes.md` (`release-notes-write.log`) |
| the same with `--check` | **0** | "is up to date" (`release-notes-check.log`) |
| `node tools/release/known-limitations.mjs --protocol-audit <r6> --check` | **0** | PASS (`known-limitations-check.log`) |
| `node tools/release/check-handover.mjs --protocol-audit <r6>` | **0** | all six checks PASS. The 8 warnings are the same 8 as at `HEAD` (`check-handover.log`). |
| `node tools/release/claims-scan.mjs` | **0** | `PASS (891 files; D 141, U 750; negated 28; allowed 19)` (`claims-scan.log`) |
| `node --test tools/release/tests/release-notes.test.mjs` | **0** | 14/14 pass: the 9 existing tests and the 5 new DO-D10 tests (`release-notes-tests.log`) |
| Mutation: the English bullet loop removed from `release-notes.mjs`, then restored (sha256 identical) | the test file exits 1 | exactly `DO-D10 … printed in English …` fails, 13 pass (`mutation-no-en-bullets.log`). Run before the Arabic layout change, which did not touch the English loop. |
| `node --test tools/release/tests/*.test.mjs licenses/tests/*.test.mjs` (run 2, final) | **1** | 471 tests: 467 pass, **2 fail**, 2 skipped (`release-tool-tests.log`). See below. |
| the same (run 1) | 1 | 466 pass, 3 fail. The extra failure was T-M2 (end), caused by my own typecheck and lint logs being written into the tree during the rehearsal. Superseded by run 2, in which T-M2 passes and `git status` was unchanged (`release-tool-tests-run1-concurrent.log`). |
| `pnpm -r typecheck` | **0** | `typecheck.log` |
| `pnpm lint` | **0** | `lint.log` |
| `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` (`openapi-lint.log`) |
| `pnpm test` | **0** | unit-node: 207 files, 3042 tests passed. unit-web: 131 files, 2199 passed. unit-formula-nocodegen: 3 files, 259 passed and 2 skipped. 16:29:21Z to 16:35:24Z (`pnpm-test.log`). |
| `git ls-files -co --exclude-standard -z \| xargs -0 node_modules/.bin/prettier --check --ignore-unknown` | **0** | "All matched files use Prettier code style!" (`prettier.log`; run before this handback was written; the handback is checked on its own, below) |
| `node tools/gates/validate.mjs --historical --stage DG6` | **0** | `PASS gate DG6 (historical)` (`validate-historical-DG6.log`) |
| Integration tests and the contract test on `with-pg.sh` | **NOT RUN, not applicable** | No product code, integration test or contract changed. |

**The 2 failures of the release-tool suite (not caused by this change):**
1. **T-A5** (`build-from-archive.test.mjs`): **BLOCKED by the sandbox.** `pnpm install` inside the network namespace exits 226: `EROFS: read-only file system, symlink … -> '/root/.local/share/pnpm/store/v10/projects/…'`. `touch /root/.local/share/pnpm/store/.w` also gives "Read-only file system". The test needs a writable pnpm store.
2. **T-G2 `--scope history`** (`secret-scan.test.mjs`): **FAIL on committed history.** It reports 2 hits, both in blobs already committed at `HEAD`:
   - `docs/delivery/reviews/DG7/round-6/qa-verifier.json:442` (S3), commit `b481b0bb3`;
   - `docs/delivery/test-evidence/DG7/qa/round-6/98-evidence-hygiene.log:4` (S2), commit `961b0256d`.

   Each is the QA reviewer's own `grep` pattern for secrets, not a secret. The history scope reads only blobs reachable from `HEAD`, so my uncommitted changes cannot affect it. `--scope payload` passes. Both paths are review and evidence records that I may not edit.

**Skipped:**
- T-A11: BLOCKED, no assembled runtime tree;
- T-A3: `bsdtar` not installed.

## 4. Known gaps / not done

1. **ADR-0071 §5.1 says the generator "reads nothing else".** It now reads one more checked-in file of its own: `tools/release/release-notes-disclosures.json`, read from the tool's directory, as `claims-scan.mjs` reads `claims-allowlist.json`. The assignment asked for a checked-in input "if practical". The ADR text (§5.1, and §5.2's list of seven sections) is not amended, because I may not edit ADRs. It needs an architect note or an orchestrator decision.
2. **The Arabic texts are provisional.** They are marked as such, and `arabic-review.json` is `[]`. The release-notes Arabic lines are mine, adapted from the analyst's approved provisional wording. The sentence "يبقى كل صف آخر مُضاف أو مُعدَّل غير مشروح" is new.
3. **The release-tool suite is not green in this sandbox:** T-A5 is BLOCKED (read-only pnpm store) and T-G2 history fails on committed review records (§3).
4. **Engine ticks (A5.7 residual 3) are still undecided.** If the orchestrator decides them, the `known-limitations.md` row, the `deployment.md` paragraph, both summaries and the disclosure JSON need updating, then `--write`.
5. **Live CI not run.** The CI seal job already runs `release-notes.test.mjs` (`deploy/ci/ci.yml` l.75); I did not change any CI file.

## 5. Open questions and merge instructions

**Open questions (for the orchestrator):**
1. ADR-0071 §5.1 and §5.2: will you record the new generator input and section (an ADR-0071 note or a decision), or do you prefer the text inlined in `TEXT`?
2. T-G2 `--scope history`: the round-6 QA record and evidence hold the reviewer's secret-pattern `grep` lines, which the history scan flags. Will you add allow-list entries in `tools/release/secret-allowlist.json` (owner DO, with a reason), or take another remedy? This is outside this task's scope.
3. A reviewer should verify F-DG7-923, F-DG7-942 and F-DG7-972 against the four handover files and `release-notes.md`.

**Merge:**
- Documentation and release tooling only: no migration and no contract change.
- If `docs/delivery/requirements.csv`, `external-dependencies.json` or a provisional-Arabic file changes after this, re-run `release-notes.mjs … --write`. Otherwise `--check` exits 1.
- Any later edit of `tools/release/release-notes-disclosures.json` also needs `--write`.
