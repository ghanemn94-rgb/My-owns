# Handback T-DG7-DO-J (devops-engineer): seal, verify-seal, release notes and the final-report template

- **Stage:** P7, DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`. Base `89e299095e9435fd31d8ed8ea5c52505923b4b16` (`git rev-parse HEAD` at start; the working tree was clean apart from this run's own `docs/delivery/runs/DG7/…` directory).
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DO-J.md`, SHA-256 `7bb84fb4be7ea4c604f83fde614eaa20f150a34937348a8d2dddc9cf7a7ca3dd` (checked with `sha256sum`; equal to the invocation's value). Task: p7-work-split §M.1.
- **Invocation:** run `DG7-T-DG7-DO-J-devops-engineer-20261113T052533Z-8545a802`, session `8545a802-d056-44e3-b81c-2e089a05bc55`.
- **Time:** `date -u` at the start `Fri Nov 13 05:25:43 UTC 2026`; at the end `Fri Nov 13 06:36:56 UTC 2026` (about 71 minutes of wall-clock time). The task overran the 60–75 minute budget. Most of the overrun is the long test runs: the rehearsal suites take about 12 and 11 minutes, because R0's V16 runs `validate.mjs --historical` for DG0–DG6.
- **Environment:** this sandbox, Linux, Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`; the shell's default `node` is v22.22.0, so every command below was run with Node 24 first on `PATH`), git 2.43.0, offline, no Docker daemon (D-243 Q1; not needed here). Disk: about 3.5–3.8 GB free throughout; every scratch clone lived under the run's `$TMPDIR` and was deleted.

## 1. Files changed

All of these are new files. Nothing outside the §M.1 list was modified. There is no `.gitignore` change, no `deploy/ci/ci.yml` change, no migration, no OpenAPI change (still 965 operations), and no `p7-pending*.ts` change: DO-J declares no operation, so no `p7-pending-do-j.ts` exists and there was no pending entry to remove.

| File | Purpose |
| --- | --- |
| `tools/release/seal.mjs` | ADR-0073 §4: CLI and module `seal(options)`; steps S1–S12; the seal report `seal-report-<n>.json` and `envelope-manifest-<n>.json`; the output-path guard (`outputPathAllowed`) and the re-seal rule; the §M.2 lines and exit codes. |
| `tools/release/verify-seal.mjs` | ADR-0073 §5: archive mode (V1–V14), repository mode (V15–V17) and final-report mode (V18); `verifySeal(...)`; `historicalValidation` (V16, exported for T-M11); `verify-report-<n>.json`; the §5.3 lines. |
| `tools/release/lib/envelope.mjs` | §3.1 list from the gate records (no folder walk), §3.4 manifest writer (key order, sorted arrays, no clock), §3.5 layout and packing, §3.6 `ENVELOPE_README_TEXT` (placeholders `<version>`, `<payload hash>`), the §4.6 `STATEMENT`. |
| `tools/release/lib/gate-labels.mjs` | Rules L1–L5 as data, plus `checkGateLabels({ gates, manifest, texts, demoTables })`, and the synthetic notes prefix (exact §M.2 text). |
| `tools/release/lib/final-report.mjs` | §7.2 line patterns, CAP-01…CAP-12, `checkFinalReport(text, { template, sealReport, isListed, fileKind })` (V18 rules 1–8), `guidePaths`. |
| `tools/release/release-notes.mjs` | ADR-0071 §5: the generator, `--write`/`--check`, the refusals, the §I.3 lines; exports `buildReleaseNotes` for the tests. |
| `docs/handover/final-report.template.md` | ADR-0073 §7.1, byte for byte. It was extracted from the ADR's code block with `awk`, not retyped. Section 2 is M0074 verbatim. |
| `tools/release/tests/seal.test.mjs` | T-M1–T-M8 and T-M13 (cases R0, R8, R9, R11, R13, plus the S1/S5/S6/S7/S10 refusals). |
| `tools/release/tests/verify-seal.test.mjs` | T-M9–T-M12 (R1–R7, R10, R12, V16 and V18 rules). |
| `tools/release/tests/release-notes.test.mjs` | T-I11 and T-I13 (fixture half). |
| `tools/release/tests/fixtures/seal/rehearsal.mjs` | SYNTHETIC rehearsal helper: sparse scratch clone (§8.1), synthetic DG7 record and reviews (§8.2), evidence placeholders, the scratch allow-list (see §4, O2), and the clone-only neutralisation of the DG3 L3 sentence (see §4, O1). |
| `tools/release/tests/fixtures/seal/demo-data/{manifest.json,tables/organization.ndjson,tables/gate_review.ndjson}` | SYNTHETIC demo-data input with product gate rows (`gate_code` G1, G2, G6) for L5. |
| `tools/release/tests/fixtures/seal/final-report.filled.md` | SYNTHETIC filled final report; its `@@TOKEN@@` values are replaced at run time with the rehearsal seal's values. |
| `tools/release/tests/fixtures/seal/release-notes/{register-SYNTHETIC.csv,external-dependencies-SYNTHETIC.json,i18n/provisional-ar-SYNTHETIC.ts}` | SYNTHETIC register (the six Q19 rows with the marker; one SPECIFIED, one BLOCKED and one PLANNED row; multi-line and quoted fields), dependency list and provisional file. |
| `tools/release/ci/seal-tests.job.yml` | Optional CI job fragment for the orchestrator to merge (§2 rule 9). Live CI was not run (D-058). |
| `docs/delivery/handbacks/DG7/T-DG7-DO-J-devops-engineer.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-DO-J-evidence/*` | Logs (listed in §3). |

**Not created:** `docs/handover/release-notes.md`. The generator refuses the register at this base (§4, O3), so writing the file would have meant bypassing a refusal the ADR requires.

## 2. Behaviour delivered, per requirement

- **REQ-DLV-041 / REQ-S20-028 (tooling and rehearsal; the real seal completes after the gate, D-243 Q19).**
  - The seal re-derives the payload from the DG7 record's `source_commit` (S3) and refuses a drifted working tree with the l.621 text (S4, and again at S12).
  - It collects exactly the §3.1 list from the gate records (8 gates, their candidate manifests, the cited reviews, 10 agent definitions and the register from `source_commit`, plus findings, stages, the 6 required evidence keys and any extras). Every envelope-only file must be committed and clean against `HEAD`.
  - It builds the payload archive through DO-A's `buildArchive` (not re-implemented), packs the envelope with `lib/tar.mjs`, and runs DO-B's `scanSecrets` (envelope and demo-data path scopes) and `scanClaims` (the payload archive's `docs/`, extracted under `$TMPDIR` and deleted).
  - It writes a seal report in which `payloadHash` and `envelopeArchive.archiveSha256` are separate fields. The manifest holds no clock, and two seals give byte-identical envelope `.tar` bytes (T-M3).
  - `verify-seal` checks V1–V18. The checks behind "all eight gate records", "the ten agent definitions", "the register and the findings", "payload hash = DG7 candidate ID", "no DG record is confused with G1–G6" and "verify package integrity" each fail on their tampering case (T-M10).
  - Every output carries the §4.6 statement. REHEARSAL-PASS is printed only with `--rehearsal`, and a release-mode verify of a rehearsal envelope fails V14 (R10).
- **REQ-DLV-031:** the template (section 2 is M0074 verbatim) and V18. Every one of the eight §7.3 rules has a failing fixture, and the filled synthetic report passes (T-M12).
- **REQ-S02-005 / REQ-S21-003 (release notes, T-I11):**
  - The "Unfinished items and release blockers" section equals the set of rows that are not IMPLEMENTED, on the fixture and on the tree's register (set equality).
  - A non-IMPLEMENTED row with empty notes, and an IMPLEMENTED row without evidence, each exit 1. `--check` drift exits 1.
  - No clock is read (identical bytes under another TZ and `SOURCE_DATE_EPOCH`), and a missing dependency list gives the Unknown line (EN and AR).
  - The Arabic summary section is marked provisional with the §H.3 line.
- **T-I13 (fixture half):** the six Q19 rows carry `completes-after-gate:` and are listed with their clause.
- **The two gate systems:** the tools never write `docs/delivery/**` in the repository and never commit. The rehearsal's DG7 record is synthetic, labelled, and exists only in the scratch clone. Nothing grants an approval.

## 3. Checks actually run (real exit codes)

Environment for every row: this sandbox, Node 24.21.0 first on `PATH`, repository at base `89e29909…` plus this task's new files. Logs are in `docs/delivery/handbacks/DG7/T-DG7-DO-J-evidence/`.

| # | Command | Exit | Result (tail) | Log |
| --- | --- | --- | --- | --- |
| 1 | `node --test tools/release/tests/seal.test.mjs tools/release/tests/verify-seal.test.mjs tools/release/tests/release-notes.test.mjs` (the §M.3 command; final run, nothing else writing to the repository) | **0** | `tests 34, pass 33, fail 0, todo 1`; 716 s. The TODO is T-M12's guide check (§4, O4). | `m3-tests.log` |
| 2 | `pnpm -r typecheck` | **0** | `apps/worker typecheck: Done`, `apps/api typecheck: Done` | `typecheck.log` |
| 3 | `pnpm lint` | **0** | `eslint . --max-warnings=0`, no output. Note: `tools/` is in ESLint's ignore list, so this does **not** lint the new `.mjs` files; `npx eslint <the new files>` only prints "File ignored because of a matching ignore pattern" (exit 1 from the warnings), which is pre-existing configuration. | `lint.log` |
| 4 | `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` | `openapi-lint.log` |
| 5 | `pnpm test` | **0** | unit-node `202 files, 2992 tests passed`; unit-web `127 files, 2133 passed`; unit-formula-nocodegen `259 passed, 2 skipped` (the skips are not from this task); 303 s | `pnpm-test.log` |
| 6 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (on the final tree, after every file of this task existed) | **0** | `All matched files use Prettier code style!` (06:35 UTC, after every file of this task existed) (`docs/` and `tools/` are in `.prettierignore`) | `prettier.log` (first run, 06:10, exit 0); `prettier-final.log` |
| 7 | `node tools/gates/validate.mjs --historical --stage DG6` | **0** | `PASS gate DG6 (historical)`, 132 s. Run at the end. At the start of this task I did **not** run it myself before writing code: ARCH-06's run and the orchestrator's `test-evidence/DG7/orchestrator/validate-historical-DG6.log` are the pre-implementation evidence. | `validate-historical-DG6.log` |
| 8 | `node tools/release/claims-scan.mjs`; `node tools/release/secret-scan.mjs --scope payload` (the new files add no hit) | **0**, **0** | `claims-scan: PASS (857 files; D 120, U 737; negated 27; allowed 19)`; `secret-scan: PASS (payload; 3054 files; allowed 33; canary (documented) 22)` | `repo-scans.log` |
| 9 | T-M14: `git --version`; `git clone -q --no-checkout --shared`; `git sparse-checkout set --no-cone '/*' '!/docs/delivery/test-evidence/' '!/docs/delivery/handbacks/' '!/docs/delivery/runs/'`; `git checkout -q <HEAD>`; `git config --bool core.sparseCheckout` | **0** each | `git version 2.43.0`; `true`. The clone is about 80 MB and takes 0.7 s. | `t-m14-git-features.log` |
| 10 | `node tools/release/release-notes.mjs --csv docs/delivery/requirements.csv --deps docs/handover/external-dependencies.json --provisional apps/web/src/i18n --out docs/handover/release-notes.md --write` (the real register) | **1** | 40 lines `release-notes: REQ-… is SPECIFIED but names no missing dependency in notes`; nothing written (§4, O3) | `release-notes-real-register.log` |
| 11 | Rehearsal evidence script (copy: `rehearsal-evidence.script.mjs.txt`): CLI `seal.mjs --rehearsal` and CLI `verify-seal.mjs --rehearsal --repo` on the **real** records and DO-B's allow-list; then the module seal and verify with the scratch allow-list and DG3 neutralised in the clone | script **0**; inner runs: seal CLI **1**, module seal **0**, verify CLI **1**, module verify **0** | See the table below the list. | `rehearsal-evidence.log` |

**What the tests ran (row 1), test by test:**

- **T-M1:** the clone's `candidate.mjs --stage DG7` equals the repository's `--ref <HEAD>`, both `sha256:7b3cc9cd1f341ac03bf8c59ee2dbeafd2cf46e9cfc32a46ef6f9cd3b06349aef` (3035 files).
- **T-M2 (R0):**
  - Seal exit 0 and verify `REHEARSAL-PASS` with V1–V18 present. V18 PASS on the filled synthetic final report.
  - V16 ran `validate.mjs --historical` for DG0–DG6 in the clone (each exit 1, recorded BLOCKED with the sparse-clone reason, ADR Residual 2) and recorded DG7 `SKIPPED`.
  - `git status --porcelain` of the repository was unchanged at the end, excluding `docs/delivery/runs/`, which the runner writes during this session.
- **T-M3:** two seals give equal envelope `tarSha256` and `archiveSha256`. The manifest has the §3.4 key order and sorted arrays, and no clock or seal commit.
- **T-M4:** R9, R8, S1 missing, S1 `FIXING`, missing `--evidence A26`, `A26=docs/delivery/findings.json`, and an uncommitted `findings.json` each give their exact §M.2 line and exit code.
- **T-M5:** R11 `--out docs/handover/x` gives exit 2 with the guard line. An existing `seal-report-2.json` without `--reseal-reason` gives exit 2. With the reason, sequence 3 is written and reports 1 and 2 are byte-unchanged.
- **T-M6:**
  - A release seal refuses the synthetic DG7 record.
  - A rehearsal refuses a DG7 record without the marker, and a marker on DG3.
  - R5 at the seal (`stage_id` `G6`) is refused.
- **T-M7:** one flipped byte in the demo-data input gives the S7 line.
- **T-M8:**
  - A planted `S1`-shaped key in the A18 evidence file gives `seal: secret scan found 1 hit(s)`, and the value is never printed whole.
  - A planted claim in `docs/handover/` gives `seal: claims scan found 1 hit(s)` on a new synthetic candidate.
  - Both planted values are assembled from fragments at run time.
- **T-M13:** after the seal, `candidate.mjs --stage DG7` in the clone prints the synthetic candidate unchanged.
- **T-M9:**
  - On the real DG0–DG6 records, L1, L2 and L4 have no hit. L3 has exactly one, in `DG3.json $.notes` (§4, O1).
  - Each rule fails on its synthetic case: R5 (L1 + L2), R6 (L2), L3, L4 and R7 (L5). The separation phrases and negations pass.
- **T-M10** (archive mode; "recomputed" means the variant that passes the tampered envelope's own checksum):

  | Case | Failed checks (kept checksum) | Failed checks (recomputed) |
  | --- | --- | --- |
  | untampered, rehearsal | none | — |
  | R10 (release-mode verify of the rehearsal envelope) | V14 | — |
  | R1 | V1, V4 | V4 |
  | R2 | V1, V3, V6 | V3, V6 |
  | R3 | V1, V3, V8 | V3, V8 |
  | R4 | V1, V3, V9 | V3, V9 |
  | R5 | V1, V3, V12 | — |
  | R6 | — | V3, V12 |
  | R7 (the tamperer covers every checksum) | — | V12 |

  The BLOCKED inputs (missing envelope, non-gzip file, missing `--expect-sha256`, payload output path) each give exit 2 with their line.
- **T-M11:** the stand-in validator (exit 1 for one stage) makes V16 FAIL and records each exit code. A missing validator gives BLOCKED for every stage, never PASS, and all-skipped gives `SKIPPED`.
- **T-M12:**
  - The filled report passes. Eleven failing fixtures cover rules 1–8: placeholder, section 2, CAP missing, CAP twice, result FAIL, evidence missing, evidence a directory, evidence not listed, checksum, seven gate lines, and an L4 sentence.
  - Through `verifySeal`, V18 fails for a missing evidence path and for an altered section 2.
  - The guide check is TODO (§4, O4).
- **T-I11 / T-I13:** 9 tests (listed in the log).

**Rehearsal evidence (row 11):**

- Clone at `89e299095e9435fd31d8ed8ea5c52505923b4b16`, plus one SYNTHETIC commit with the DO-J working-tree files. The synthetic DG7 candidate is `sha256:c43986181510fe912c14892cc57b422ddb20c373e4fc150e8dd1288f89c38564`.
- Demo-data input (SYNTHETIC fixture) `inputSha256` `4f4c242c20c58303a1a47907157d8c2a6f54898a7de9ef0ef7ea2a68a55dd74a`.
- 67 envelope files: 8 gate records, 32 review records, 10 agent definitions, register with 412 rows, findings, stages, and 6 evidence placeholders. Of these, 221 findings were recorded, none DG7.

| Run | Exit | Time | Result |
| --- | --- | --- | --- |
| Seal CLI, real allow-list | 1 | 32.6 s | Fails at S10 with two masked `S1` hits in `docs/delivery/reviews/DG6/round-7/code-security-reviewer.json:220` (value sha256 `457643f44d19…`) (§4, O2). |
| Module seal, scratch allow-list | 0 | 35.4 s | Payload archive `mth-transformation-hub-0.1.0-c43986181510-REHEARSAL.tar.gz`, sha256 `e2209d70f565aad33953df2b22058767a86e9453a54f8421c95d6eb365d17373`. Envelope archive `mth-transformation-hub-0.1.0-c43986181510-envelope-REHEARSAL.tar.gz`, sha256 `c1426e099a4a9a2eeff35363053c5072e3f6cf5ba171ae31b77cad76fa619a67` (equal to `sha256sum`). Envelope manifest sha256 `1094a336335565615692e1e2ed28d7f59b13fd9591695fbd656c71b1d3e7fc83`. |
| Verify CLI, real records and real allow-list | 1 | 295.3 s | `FAIL (3 checks)`: V12 (the DG3 L3 sentence), V13 (the same DG6 review hit) and V17. V17 failed because my script passed a different `--out` than the seal used, so no seal report was there; the tool reported that correctly. It is not a tool defect. V16 was BLOCKED for DG0–DG6 in the sparse clone. |
| Module verify, second clone with DG3 neutralised and the scratch allow-list | 0 | 143.9 s | `REHEARSAL-PASS`. V16 was limited to DG0, DG6 and DG7 in this script; the full run is R0. |

## 4. Known gaps and open questions

**Not done, or done differently from the letter of the assignment (each is deliberate and disclosed):**

1. **`docs/handover/release-notes.md` was not generated (§M.1 expected it "from the register at DO-J's base").** The generator refuses the register (row 10): 40 SPECIFIED rows have empty `notes`, and ADR-0071 §5.4 requires exit 1 for "a row that is not IMPLEMENTED with empty notes". Generating the file anyway would have meant bypassing a refusal the ADR mandates. AN-P7 must name the missing dependency in those 40 rows' notes and then run `--write` (p7-work-split §M.5 step 3). The 40 ids are in `release-notes-real-register.log`.
2. **Acceptance "every §M.1 test passes":** 33 pass and one is TODO. T-M12's guide check is TODO because `docs/handover/{deployment,operator-guide,known-limitations,release-notes}.md` don't exist yet (DOC-B, W9; AN-P7, W12). ADR-0073 §7.1 says a guide missing *at the freeze* fails. The test runs strictly with `MTH_STRICT_GUIDES=1`, and the freeze verification must set it.
3. **R0 passes only with two scratch-only adjustments,** both made only inside the clone and both labelled:
   - DO-B's allow-list plus the requested envelope entry (O2);
   - DG3's L3 sentence neutralised in the clone's copy (O1).
   
   On the real records the same envelope fails V12 and V13 (row 11). **As things stand, a real A28 run would FAIL.** O1 and O2 must be resolved before the seal.
4. **Interpretation choices in the tools** (all small; a reviewer may judge them):
   - (a) **L4 and the synthetic marker.** The exact §M.2 synthetic notes prefix ends "it approves nothing", which meets the L4 pattern (`\bit\b … approves`, no listed negation word). `gateTextOf` removes that exact prefix before L3/L4. Any text after it is still checked.
   - (b) **V18 rule 8 and the template's section 3.** The fixed sentence "G1-G6 are business approvals inside the product" meets L4 by construction, so rule 8 scans the report without sections 2 and 3. Rule 2 still holds them byte-equal to the template, and an altered section 2 or 3 stays in the scan.
   - (c) **S12 runs just before S11 writes the reports,** so the report records S12. The report's `steps` are sorted S1…S12.
   - (d) **The output-path guard and the re-seal rule are checked before S1,** so a refusal leaves nothing behind. A directory outside the repository is allowed, because it cannot change the payload hash.
   - (e) **Seal lines not in §M.2:**
     - `seal: <path> has stage_id "<v>", not DG7 (rule L1)` (exit 1; R5 at the seal);
     - `seal: a rehearsal seal refuses a synthetic marker on <path>` (exit 1);
     - usage BLOCKED lines;
     - `--extra` path refusal;
     - DO-A's demo-data `ArchiveError` texts passed through with a `seal:` prefix.
   - (f) **V16 in a rehearsal on a sparse clone:** a non-zero exit is BLOCKED with the Residual 2 reason and does not prevent REHEARSAL-PASS, as R0 of ADR-0073 §8.3 expects. In release mode a non-zero exit is FAIL, and a validator that cannot run is BLOCKED (exit 2). All-skipped is `SKIPPED`, never PASS.
   - (g) **V3 also checks** that `README.txt` is the §3.6 text and that the manifest's top-level keys are in §3.4 order.
   - (h) **Module-only test seams:** `secretAllowlist` (seal and verify), `historicalStages` and `writeReport` (verify). The CLIs have no such flags and always use DO-B's allow-list and all eight stages.
   - (i) **`release-notes.mjs` reads `apps/api/package.json` and `docs/api/openapi.yaml`.** ADR-0071 §5.1 says it "reads nothing else", but §5.2 item 1 requires those two versions. A missing file shows `Unknown`. The provisional files are `provisional-ar*.ts` in each `--provisional` directory plus the five fixed component files of p7-plan §1.4.
   - (j) **The CLIs print each check or step line as well as the exact §M.2/§5.3 lines,** and the statement on success.
   - (k) **T-M2's repository-status comparison excludes `docs/delivery/runs/`,** the runner's own directory for this session.
5. **The DO-J files are not committed** (the orchestrator commits). The rehearsal therefore overlays the working-tree DO-J files onto the clone in one SYNTHETIC clone commit, so its payload carries the tools and template it rehearses.
6. **`pnpm lint` does not lint `tools/**`** (pre-existing ESLint ignore). The new tools have no lint coverage. `node --check` passes on each file.
7. **Not applicable:** no integration or contract test was touched (no operation, no migration, no permission), so no `with-pg.sh` run was needed. No `p7-pending` entry exists for DO-J. The time budget was exceeded (header).

**Open questions for the orchestrator:**

- **O1. Real L3 hit in an approved gate record (T-M9; D-243 Q13: report, never rewrite).**
  - `docs/delivery/gates/DG3.json` `$.notes` contains the sentence "(2) For backend-workflow-engineer and frontend-ux-engineer, carried to DG6 (REQ-S15-007): the D-079 limitation, where a G4 capacity-conflict item can show a role's English labelEn in Arabic…". It names DG6 and G4 with none of the separation phrases. It is not a confusion of the two systems, but the ADR's L3 rule flags it.
  - **A real A28 will fail V12 until this is decided.** The options are a gate-tooling decision:
    - an ADR-0073 amendment for L3 (for example, a reviewed acknowledgement list of exact sentence hashes in approved records, each with a reason, in the manner of DO-B's allow-lists);
    - or narrowing L3 to fields other than `notes`.
  - DO-J has not changed the rule, and T-M9 pins this exact hit set, so any new hit fails.
- **O2. Envelope secret-scan hit; allow-list entry requested from DO-B** (p7-work-split §M.4 seam G).
  - The hit is in the approved review record `docs/delivery/reviews/DG6/round-7/code-security-reviewer.json` l.220. It quotes the synthetic AWS-shaped redaction fixture of `operations/exceptions.test.ts`, and it is not a credential.
  - Please add to `tools/release/secret-allowlist.json`:
    `{"rule": "S1", "path": "docs/delivery/reviews/DG6/round-7/code-security-reviewer.json", "valueSha256": "457643f44d19aed85fd756aa50cc0cd6b57376d4e8f5a72f9f85972a522002a3", "reason": "approved DG6 review narrative (l.220) quoting the synthetic AWS-shaped redaction fixture of operations/exceptions.test.ts; not a credential", "scopes": ["envelope"]}`
  - The same entry is in `tools/release/tests/fixtures/seal/rehearsal.mjs` (`ENVELOPE_ALLOW_REQUESTS`). Once DO-B merges it, the scratch allow-list there can be dropped.
  - The rehearsal scanned only DG0–DG6 records. DG7's own review records will be scanned at the seal.
- **O3. Register notes (AN-P7).** 40 SPECIFIED rows have empty notes, so the release notes cannot be generated (gap 1). Also, no row carries `completes-after-gate:` yet. T-I13's freeze half (QA-D) needs the six Q19 rows marked.
- **O4. Handover guides missing (DOC-B, W9):** `deployment.md`, `operator-guide.md` and `known-limitations.md`, plus `release-notes.md` (O3). The freeze verification should run the §M.3 command with `MTH_STRICT_GUIDES=1`.
- **O5. `docs/handover/README.md` index lines requested from DOC-B** (§2 rule 10):
  - `release-notes.md`: "Release notes: identity, requirements by status, unfinished items and release blockers, later clauses, external dependencies, provisional Arabic texts (generated by `tools/release/release-notes.mjs`; REQ-S19-015 item 'Release notes')";
  - `final-report.template.md`: "Final delivery report template (ADR-0073 §7; filled by the orchestrator after the seal and checked by `verify-seal.mjs --final-report`)".
- **O6. Run time.** Each rehearsal suite takes 11–12 minutes on this host, because R0's V16 runs the historical validator seven times, 22–132 s each. If that is too long for routine use, a decision could limit R0's V16 to fewer stages (T-M11 covers the logic). I left it complete because R0 is specified with DG0–DG6.

## 5. Merge instructions

- **Commit:** one commit with every file of §1. No migration, contract, generated-file or `p7-pending` change, and no conflicts expected. All files are new, and only DO-J owns `tools/release/{seal,verify-seal,release-notes}.mjs`, `tools/release/lib/{envelope,gate-labels,final-report}.mjs`, `tools/release/tests/{seal,verify-seal,release-notes}.test.mjs`, `tools/release/tests/fixtures/seal/**` and `docs/handover/final-report.template.md`.
- **CI (optional):** merge `tools/release/ci/seal-tests.job.yml` per its header (needs `delivery-gates`; about 25 minutes), then run `node deploy/scripts/check-ci-needs.mjs`.
- **Before the freeze:**
  - DO-B merges the O2 entry;
  - the orchestrator decides O1;
  - AN-P7 fills the 40 notes and the six markers, then runs `node tools/release/release-notes.mjs --csv docs/delivery/requirements.csv --deps docs/handover/external-dependencies.json --provisional apps/web/src/i18n --out docs/handover/release-notes.md --write`;
  - the freeze verification runs the same with `--check`, and `MTH_STRICT_GUIDES=1 node --test tools/release/tests/seal.test.mjs tools/release/tests/verify-seal.test.mjs tools/release/tests/release-notes.test.mjs`.
- **After DG7 approval only (orchestrator, ADR-0073 §1 steps 4–6):** `node tools/release/seal.mjs --candidate <DG7 id> --demo-data dist/release/inputs/demo-data --demo-data-sha256 <recorded> --evidence A18=… --evidence A19=… --evidence A26=… --evidence A27=… --evidence test-level-index=… --evidence protocol-audit=…`, then `node tools/release/verify-seal.mjs --envelope dist/release/<name>-envelope.tar.gz --expect-sha256 <hex> --repo . --final-report docs/delivery/test-evidence/DG7/seal/final-report.md`. Only `verify-seal: PASS` from that run allows the declaration.
- **Two gate systems:** sealing and its verification grant no business, Finance or IT approval. Product gate G6 does not imply engineering gate DG7, and DG7 does not imply any product gate G1–G6. This handback approves nothing.
