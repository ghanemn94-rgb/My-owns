# Handback T-DG7-SA-ADR72 (solution-architect): ADR-0063 Amendment 2 and ADR-0066 Amendment 1

- **Stage:** DG7 (BUILDING).
- **Run:** `DG7-T-DG7-SA-ADR72-solution-architect-20261117T164920Z-dce6ed32`, session `dce6ed32-7f46-44d5-b7f1-2b2d4ab9e355`.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-SA-ADR72.md`. Its sha256 `80bb2339…a7d2` was verified at the start.
- **Base:** `faa1154ca9d15e160bf39f5a2a0df575ec1bf133`, recorded in both amendments.
  - During the run, the orchestrator committed `90cbc1c3b350ce51a8944d136a7aca34ec214c1e` on top of it. That commit changes only `docs/delivery/{assignments,decisions.md,findings.json}` and `tools/gates/import-findings.mjs`. No product file, ADR, script or test changed, so every measurement below holds at both revisions.
- **Branch:** the working tree is on `claude/mobily-transformation-platform-dg7-regate`. The assignment says `claude/mobily-transformation-platform-dg6-regate` (see §5 Q3).
- **Time:** started 16:49:30Z, ended about 17:41Z.
- **Findings repaired:** F-DG7-1032, F-DG7-1041 and F-DG7-1052, which are one defect. Documentation only.
  - I wrote no review, gate or findings record. An originating reviewer has to verify the repair.
  - Nothing here is a business, Finance or IT approval, and nothing implies DG7.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `docs/architecture/adr/ADR-0063-p7-secret-hygiene-claims-scan-security-controls-evidence.md` | **Amendment 2** (dated 2026-11-17), appended, with sections A2.1–A2.4. Pointers were added in the §1.2 S3 "do not match" cell and in §5 residual 1. No other existing text changed. |
| `docs/architecture/adr/ADR-0066-p7-backup-restore-backup-set-manifest-restore-checks-drill.md` | **Amendment 1** (dated 2026-11-17), appended, with sections A1.1–A1.5. Pointers were added in the §4 lead sentence and in the §5 `<backup-root>` sentence. No other existing text changed. |
| `docs/delivery/handbacks/DG7/T-DG7-SA-ADR72-solution-architect.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-SA-ADR72-evidence/` | Logs `01`–`13` and three read-only measurement scripts (`scripts/map.mjs`, `scripts/hex64.mjs`, `scripts/hex64h.mjs`). |

I made no code, test, fixture, guide, allow-list, migration, OpenAPI or lock change. I added and removed no `p7-pending` entry, because this task has none.

## 2. Behaviour delivered (REQ-S16-031, REQ-S19-012; F-DG7-1032/1041/1052)

**ADR-0063 Amendment 2 (S3 as built).**

- **A2.1: S3 as built, every exception, in the order the code tests them.** Before this, the §1.2 cell was a simplified subset even before DO-D11. The amendment lists:
  - the key pattern, including the `secretar…` exclusion;
  - the code-file rule for unquoted values;
  - the dedupe with S1/S2 hits on the same line;
  - the 18 ordered tests of `isNonSecretValue`.

  It also says exactly which T-G1 fixture line pins which test, and which tests have **no** dedicated fixture: 2, 4, 5, 6, 7, 14–17, the low-entropy side of 18, and the dedupe. The mapping was measured, not inferred (log `01`). The script asserts that its key pattern equals `SECRET_KEY` in the source.
- **A2.2: the narrowed i18n-key rule**, as `isI18nKey` implements it:
  - at least one `.` or `_` separator;
  - each segment at most 20 characters and at most 3 digits;
  - the consequences, and the tests that pin it.

  It also records a limit that the narrowing does not cover. The namespaced-identifier exemption (test 13) still exempts a lower-case value split by `.`, `:` or `/`, with no segment limits. This is new residual 10.
- **A2.3: the 64-hex trade-off and the architect's answer to DO-D11 §4 item 3.**
  - **Measurement** (log `02`). At the base, an S3 match whose value is exactly 64 hex occurs **once** in the tracked tree. The same holds over every text blob of `git rev-list --objects HEAD` (54,427 tree and blob entries outside `trading_agent/`). That one place is line 13 of the T-G1 non-match fixture. No real content of the repository needs the exemption.
  - **Correction during the run.** My first draft justified keeping the exemption with a `git grep` count of 180 files. That count over-matched: those are path→digest maps where the secret word is inside a quoted path, which `ASSIGNMENT` does not read as a key. I replaced the rationale with the exact re-implementation measurement before finishing.
  - **Decision.** The amendment records the behaviour as built and discloses it as residual 9. It recommends a specific narrowing: exempt 64 hex only under a digest-named key (`sha`, `hash`, `digest`, `checksum`, `integrity`, `fingerprint`), and keep `sha256:` and `sha512-` exempt everywhere. It names the code, fixture and history-allow-list changes that would need. Whether to assign that code change is the orchestrator's call (§5 Q1). It is not a breaking contract change, and SC-13 already discloses the residual to IT.
- **A2.4:** residuals 9 and 10, appended to §5.

**ADR-0066 Amendment 1 (backup-time checks and the backup root as built).**

- **A1.1: the checks as built**, with their manifest ids in order:
  - `dumpReadable`, `clientMajorAtLeastServer`, `evidenceVerified`, `evidenceFilesMatchNames`, `retentionSetsMatch`, `everyFileMatches`, and the new **`ownerOnly`**;
  - the mapping to the original §4 items 1–5;
  - what a failed check does: `backup_fail` exits 1, records the set as `failed` with its reason, and writes no manifest.
- **A1.2: a drift that was not in the findings.** `evidenceVerified` (§4 item 3) is recorded only when `backup.sh` can run `transfer-attachments` itself. In the Compose sequence (`MTH_TRANSFER_ATTACHMENTS=none`), item 3 is met by the step-2 copy-out, which fails on a missing or differing object, together with `evidenceFilesMatchNames`. A Compose manifest therefore has 6 `checks`, and a `--phase all` manifest has 7.
- **A1.3: the owner-only set and the backup root.**
  - The set: `umask 077`, `0700`/`0600`, `backup_owner_only` after each phase (T-E10, T-E11).
  - The refused root (T-E12): a group- or world-writable root is refused with exit 2 before any database access, and nothing is written. A root that is only readable (0755) is accepted.
  - **A root given as a symbolic link is resolved to its target (`readlink -e`, chains included) and judged by the target**, as DO-D12 implements it (T-E13a–d). An owner-only target is accepted, and the set is written through the resolved path. A group- or world-writable target, a dangling link and a non-directory target are each refused with exit 2.
  - Ancestors of the root are not judged (new residual 7).
- **A1.4: the Compose mount.** `MTH_BACKUP_ROOT` is required, there is no `/tmp` fallback, and the mount uses `create_host_path: false`, not `:?`. The amendment states plainly that the Compose half is unverified in the sandbox and belongs to the orchestrator's host run (D-283).
- **DO-D11 §5 Q2, second half:** the restore checks R1–R9 and guide §7 do **not** gain an owner-only check, because restore does not judge modes. This is recorded under "Unchanged".
- **A1.5:** residuals 7 (root ancestors), 8 (ACLs and the owner's identity are not checked) and 9 (the Compose half is unverified).

**Checked against the code and tests:**

- `tools/release/secret-scan.mjs` and `tools/release/tests/secret-scan.test.mjs`;
- `tools/release/tests/fixtures/secrets/non-matches.txt`;
- `deploy/scripts/backup.sh`, at the base and with DO-D12's working-tree diff;
- `deploy/compose/compose.yaml` (the `backup` service);
- `deploy/scripts/tests/backup-restore.test.mjs` (T-E1–T-E13);
- `tools/release/tests/service-list.test.mjs` (the F-DG7-1012 static test);
- `docs/handover/backup-restore.md` §3.2/§3.3;
- `docs/handover/security-controls.md` SC-13.

## 3. Checks actually run

Environment: Node v24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, in the bubblewrap sandbox with no network. The working tree is shared with DO-D12 and AN-P7J, which were editing concurrently. Logs are in `docs/delivery/handbacks/DG7/T-DG7-SA-ADR72-evidence/`.

| # | Command | Result | Exit |
| --- | --- | --- | --- |
| 01 | `node …/scripts/map.mjs`: which A2.1 test exempts each T-G1 fixture line | as stated in A2.1 | 0 |
| 02 | `node …/scripts/hex64.mjs`; `node …/scripts/hex64h.mjs`: S3 matches with an exactly-64-hex value, over the tracked tree and the history blobs | 1 file, 1 match (the T-G1 fixture), in both | 0 / 0 |
| 03 | `node tools/release/secret-scan.mjs --path ADR-0063 --path ADR-0066 --path <evidence dir>` | FAIL, 1 hit: S2 at ADR-0063 **l.40**. That line is **pre-existing** and unchanged (the Context 3 quote of the redaction fixture). It is allow-listed for payload and history, and the allow-list does not apply in the path scope. See 06 | 1 |
| 04 | `node tools/release/secret-scan.mjs` (payload scope) | `PASS (payload; 3159 files; allowed 33; canary (documented) 22)` | 0 |
| 05 | `node tools/release/claims-scan.mjs` | `PASS (891 files; D 141, U 750; negated 28; allowed 19)` | 0 |
| 06 | `secret-scan --path` over only the **lines I added** (extracted from `git diff -U0`), the whole ADR-0066, and the evidence scripts and logs 01/02 | `PASS (path; 8 files; allowed 0)`. It also shows l.40 at HEAD | 0 |
| 07 | `node tools/gates/validate.mjs --historical --stage DG6` | `PASS gate DG6 (historical)` | 0 |
| 08 | `node --test tools/release/tests/secret-scan.test.mjs tools/release/tests/claims-scan.test.mjs tools/release/tests/security-controls.test.mjs` (the two tests that read `docs/architecture/adr`) | 199 tests, 199 pass, 0 fail | 0 |
| 09 | `pnpm -r typecheck` | `Done` | 0 |
| 10 | `pnpm lint` (`eslint . --max-warnings=0`) | no output | 0 |
| 11 | `pnpm openapi:lint` | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` | 0 |
| 12 | `pnpm test`, first run (17:21Z–17:32Z, load average about 11, with DO-D12 and AN-P7J running in the same tree) | **FAIL**: unit-node 206/207 files. `tests/qa/unit/a13-child-ready-race.test.ts` "resolves for a child that prints READY and exits at once, 50 times in a row…" hit `Test timed out in 5000ms`. unit-web 131/131 files (2199 tests); formula 3/3 files (259 pass, 2 skipped) | **1** |
| 14 | `npx vitest run --project unit-node tests/qa/unit/a13-child-ready-race.test.ts`, alone | 6/6 pass, 2.49 s. The file was last changed in `e44dcd90e`, and nothing in this task touches it | 0 |
| 15 | `pnpm test`, second full run (17:33Z–17:39Z) | unit-node 207/207 files, 3042 tests; unit-web 131/131 files, 2199 tests; formula 3/3 files, 259 pass, 2 skipped | **0** |
| 13 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | `All matched files use Prettier code style!` (npm config warnings only) | 0 |

- **Not run: the integration tests on a disposable PostgreSQL** (`with-pg.sh`). I touched no integration test and no code, so none is in scope. The contract test is unaffected, because the OpenAPI file is unchanged.
- **The first `pnpm test` failure is disclosed, not hidden.** It was a 5-second timeout in a harness that spawns 50 child processes, on a loaded host. It passed alone (14) and in the full re-run (15). I changed no code, so it is not caused by this task. If it recurs under load, the QA owner may want to look at it.
- **Not run: the backup tests (T-E1–T-E13).** They belong to DO-D12, which is changing `backup.sh` concurrently. My amendment cites them by name. Running them would only reflect DO-D12's unfinished state.

## 4. Known gaps

1. **ADR-0066 A1.3 item 3 depends on DO-D12.** At the base, `backup.sh` still judges a symbolic-link root by the link's own mode (F-DG7-1053 open). The amendment says so explicitly. It is exact only once DO-D12's change (seen as an uncommitted diff during this run, with T-E13a–d) is merged with its current messages.
   - If DO-D12 changes the message text, A1.3 item 3 must follow. That is one quoted line: `BLOCKED: the backup root <link> is a symbolic link to <target>, which is writable by group or others; use an owner-only directory (chmod 0700)`.
2. **The 64-hex exemption is not narrowed**, because this task is documentation only. Residual 9 discloses it, and A2.3 recommends the narrowing (see §5 Q1).
3. **No dedicated fixture exists** for S3 tests 2, 4, 5, 6, 7, 14–17, the low-entropy side of 18, or the S1/S2 dedupe. Amendment 2 records this; I added no test.
4. **The Compose half** (the `MTH_BACKUP_ROOT` refusal, the root-owned `0700`/`0600` set, step 2 with `--user 0:0`) is unverified here, because there is no Docker daemon (D-243 Q1). It is the orchestrator's host run.
5. **`known-limitations.md`** (DO-D11 Q3) is not addressed. It is outside this assignment and outside my write scope (`docs/handover/**`).

## 5. Open questions

1. **(Orchestrator) Narrow the 64-hex S3 exemption?** My recommendation as ADR owner is yes, as specified in ADR-0063 A2.3 item 2:
   - exempt 64 hex only under a digest-named key;
   - rekey T-G1 fixture line 13 and add a planted 64-hex secret that must be reported;
   - add one value-wide history-only allow-list entry for the old fixture blobs.

   The measured cost is that single fixture line. If you prefer to defer it, residual 9 and SC-13 already disclose it, and the ADR stays exact either way.
2. **(Reviewers) A1.2 of ADR-0066** records a drift that none of the three findings named: `evidenceVerified` is absent from the manifest of the Compose sequence. The handover guide does not state that the Compose manifest has six checks. If reviewers want the guide to say so, that is a one-line DO edit to `backup-restore.md` §4 or §7.
3. **Branch name.** The assignment names `claude/mobily-transformation-platform-dg6-regate`. The working tree is on `claude/mobily-transformation-platform-dg7-regate` (D-281), and both amendments record the actual branch. Please confirm that this is the intended base.

**Merge instructions.** No migration and no ordering constraint for my two ADR files. Merge ADR-0066 Amendment 1 together with DO-D12's `backup.sh` and test change (gap 1). DO-D12 does not edit the ADRs, so no conflict is expected.
