# T-DG7-DO-J2 handback: A28 rehearsal blockers O1/O2 and the secret-scan hits (devops-engineer)

- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DO-J2.md` (sha256 `089163c8…38e8e`, verified at start).
- **Invocation:** run `DG7-T-DG7-DO-J2-devops-engineer-20261114T144717Z-158a2cd2`, session `158a2cd2-de76-4da7-adad-bf221bcf11bc`.
- **Stage and base:** DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`. The base `HEAD` at start was `72592bbde`.
- **Time:** `date -u` at start `Sat Nov 14 14:47:27 UTC 2026`; at end `Sat Nov 14 16:00:10 UTC 2026` (about 73 minutes; `pnpm test` run 2 finished at that time and is recorded in §3, row 22).
- **Environment:**
  - this sandbox, Linux, Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin` first on `PATH`), offline (`MTH_PNPM_OFFLINE=1`);
  - PostgreSQL only through `tests/qa/support/with-pg.sh` (disposable clusters on ports 24611, 24631, 24651);
  - no Docker daemon used or needed;
  - about 15 GiB RAM shared with the other runs, 17 GB disk free;
  - every scratch clone lived under the run's `$TMPDIR` and was removed.
- **Not alone:** the assignment says "you run alone", but T-DG7-DO-E2 (devops-engineer, started 14:46:56) ran concurrently in the same working tree, and the orchestrator committed twice (`9d52958ab`, `4140c9828`). See §4, item 1.

This handback approves nothing. Acknowledging a sentence or allow-listing a value grants no business, Finance or IT approval. Product gate G6 does not imply engineering gate DG7, and DG7 does not imply any product gate G1–G6.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `tools/release/gate-labels-acknowledged.json` (new) | O1: the reviewed acknowledgement list for V12 L3/L4. It has one entry, the DG3 `$.notes` sentence (rule L3, sentence sha256 `9c3e2203…def053`), with its reason. File sha256 `bab2ceae…821309e`. |
| `tools/release/lib/gate-labels.mjs` | O1: `parseAcknowledgements` and `sentenceSha256`; `checkGateLabels({ …, acknowledged })` returns `acknowledged[]`; stale entries are hits. The rule texts and patterns are unchanged. |
| `tools/release/verify-seal.mjs` | O1: V12 reads the list from the **sealed payload** (`source/tools/release/gate-labels-acknowledged.json`). A refused list fails V12. The pass line names each acknowledged sentence. Module test seam: `labelAcknowledgements`. |
| `tools/release/secret-allowlist.json` | O2: the requested S1 `envelope` entry for `reviews/DG6/round-7/code-security-reviewer.json`. Plus two **history-only** entries for the raw values that remain in old blobs of the two reworded files (§2). |
| `tools/release/secret-scan.mjs` | S2 no longer matches the scanner's own mask (`[S2:x…]`) quoted in a committed scan log or transcript. Without this, every logged FAIL is a permanent history hit (§2). |
| `tools/release/tests/fixtures/seal/rehearsal.mjs` | Removed both scratch-only adjustments: `ENVELOPE_ALLOW_REQUESTS`/`scratchAllowlist` (O2) and `DG3_L3_SENTENCE`/`neutralizeKnownLabelHits` (O1). |
| `tools/release/tests/seal.test.mjs`, `tools/release/tests/verify-seal.test.mjs` | Use the real allow-list and the real DG3 record (no `secretAllowlist` seam, no neutralisation). Four new tests: three T-M9 (DO-J2) and one T-M10 (DO-J2). |
| `tools/release/tests/secret-scan.test.mjs` | New T-G1 case for the own-mask rule; a real credential URL on the next line is still a hit. |
| `deploy/scripts/drill/guide-keys.json` | AN-P7 hits l.14 and l.30 (S3): every value is reworded from `docs/handover/deployment.md#x` to `#x`, relative to the file's existing `"guide"` key, and `purpose` says so. Both consumers already accept `#x`: `config-trace.mjs` `anchorOf`, and `check-handover.mjs` `startsWith("#")`. |
| `packages/db/test/integration/transfer-load.test.ts` | AN-P7 hit l.104 (S2): the unreachable URL is now `postgres://mth_owner@127.0.0.1:1/none`, with no dummy password. The CLI refuses on the package checksum before any connection. |
| `docs/delivery/handbacks/DG7/T-DG7-DO-J2-evidence/**` | Logs, plus the rehearsal script `a28-rehearsal.script.mjs.txt`. |

No gate record, review record, `tools/gates/**`, `stages.json`, `findings.json` or `test-evidence/**` was touched. `git diff HEAD -- docs/delivery/gates docs/delivery/reviews` is empty; DG3.json sha256 is `c906db0e…c281cff` and the DG6 round-7 code-security record is `9d2e5ce8…183e11`. No `p7-pending` entry belongs to this task. No migration, contract or permission change.

## 2. Behaviour per requirement

**REQ-DLV-041 / REQ-S20-028 (A28 rehearsal; the real seal still completes after the gate, D-243 Q19).**

- **O1 (L3 hit on approved `gates/DG3.json` `$.notes`).** I chose the option ADR-0073 §6 / DO-J O1 names first: "a reviewed acknowledgement list of exact sentence hashes in approved records, each with a reason, in the manner of DO-B's allow-lists".
  - The L3 rule and its phrase list are **unchanged**. The rule was not narrowed to non-`notes` fields, which would blind L3 for every record, DG7's included.
  - An entry matches only `rule + path + jsonPath + SHA-256 of the exact sentence`, so a one-character edit makes it a hit again (tested).
  - Only `L3`/`L4` and only `docs/delivery/gates/DG0–DG6.json` can be acknowledged. The loader refuses DG7, globs, review paths, L1/L2/L5, a bad hash, a reason under 40 characters, a non-JSON path and duplicates (tested).
  - The README and final-report texts are never acknowledgeable, even with a matching hash (tested).
  - An entry that matches nothing in a checked record is a stale hit (tested).
  - verify-seal reads the list from the payload archive, so the list that counts is the one reviewed with the candidate. Emptying it in the payload brings the L3 hit back as a V12 FAIL (T-M10 DO-J2).
  - The acknowledged sentence: "(2) For backend-workflow-engineer and frontend-ux-engineer, carried to DG6 (REQ-S15-007): the D-079 limitation, where a G4 capacity-conflict item can show a role's English labelEn in Arabic, is acceptable as disclosed for DG3". DG6 is the engineering stage the item was carried to, and G4 is the product gate whose item shows the label defect. Neither is equated with the other.
- **O2.** The requested entry is merged as DO-J specified (`S1`, value sha256 `457643f4…2002a3`, `scopes: ["envelope"]`). The same value was already allow-listed for the source fixtures `operations/exceptions.test.ts` and `exception-redaction.test.ts`.
- **Rehearsal with no scratch-only adjustment:** CLI seal **exit 0**, CLI verify **exit 0** `REHEARSAL-PASS`; R0 inside `seal.test.mjs` passes (§3).

**REQ-S16-031 (repository secret scan); AN-P7 §2.2 item 2.**

- The three payload hits are **reworded, not allow-listed**, per D-266 (b): `secret-scan --scope payload` exits 1 before (3 hits) and 0 after.
- **Additional finding, not in the assignment:** `--scope history` (T-G2's second case) also failed at the base, with 5 hits that rewording cannot remove:
  - the old blobs of `guide-keys.json` (S3 `1f753298…` ×2) and `transfer-load.test.ts` (S2 `2d711642…`, the password `x`) are in git history;
  - AN-P7's committed evidence log and run transcript quote the scanner's own masked output `postgres://mth_owner:[S2:x…]@…`, which S2 then matched again (`f81eacd8…`).
- Repair:
  - two `scopes: ["history"]` entries for the two raw values. They do not apply to payload or envelope scans, so the payload stays reworded-clean;
  - one scanner rule fix: an S2 password starting with the scanner's own mask prefix `[S<n>:` is not a credential.
- History scan after: **exit 0**. A path scan of this task's evidence directory is also clean (§3), so committing these logs adds no history hit.

## 3. Checks run (real exit codes)

Node 24.21.0, offline. Logs are in `docs/delivery/handbacks/DG7/T-DG7-DO-J2-evidence/` (abbreviated `E/`).

| # | Command | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| 1 | `node tools/release/secret-scan.mjs --scope payload` (before any change) | **1** | 3 hits (the AN-P7 ones), 8.5 s | `E/secret-scan-payload.before.log` |
| 2 | the same, after the rewording and the scanner fix | **0** | `secret-scan: PASS (payload; 3140 files; allowed 33; canary (documented) 22)`, 15.3 s | `E/secret-scan-payload.after.log` |
| 3 | `node tools/release/secret-scan.mjs --scope history` at `HEAD` `4140c9828` | **0** | `secret-scan: PASS (history; 35277 files; allowed 233; canary (documented) 39)`, 5 min 13 s | `E/secret-scan-history.log` |
| 4 | `node --test tools/release/tests/secret-scan.test.mjs patterns.test.mjs security-controls.test.mjs`, **before** rows 3 and 5's repair | **1** | 129/130. T-G2 history failed with 5 hits; that is how the history gap of §2 was found. | `E/secret-scan-selftests.log` |
| 5 | `node --test --test-name-pattern="T-G1\|T-G3" tools/release/tests/secret-scan.test.mjs` | **0** | 23/23, incl. the new own-mask case | `E/secret-scan-T-G1.log` |
| 6 | `node tools/release/secret-scan.mjs --path docs/delivery/handbacks/DG7/T-DG7-DO-J2-evidence` (at 15:58) | **0** | `secret-scan: PASS (path; 23 files; allowed 0; canary (documented) 0)`, so committing these logs adds no history hit | `E/secret-scan-evidence-path.log` |
| 7 | `QA_PG_PORT=24611 tests/qa/support/with-pg.sh npx vitest run --project integration packages/db/test/integration/transfer-load.test.ts` | **0** | 10/10, 57 s | `E/transfer-load.integration.log` |
| 8 | `QA_PG_PORT=24631 tests/qa/support/with-pg.sh node --test deploy/scripts/tests/transfer-drill.test.mjs` | **0** | 47/47, incl. "the shipped map covers every .env.example key and every anchor exists in the shipped guide", 2 min 44 s | `E/transfer-drill.with-pg.log` |
| 9 | `QA_PG_PORT=24651 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | **0** | 111/111, 3 min 29 s | `E/contract.integration.log` |
| 10 | `node --test deploy/scripts/tests/transfer-drill.test.mjs tools/release/tests/check-handover.test.mjs` (no PG) | **1** | The drill tests that need PG are BLOCKED without `with-pg.sh` (row 8 is the real run). One check-handover failure is **pre-existing** and unrelated (§4, item 4). The guide-keys cases pass. | `E/guide-keys-consumers.log` |
| 11 | `node tools/release/check-handover.mjs` | **2** | BLOCKED (index: `release-notes.md` missing; generated: no protocol-audit report). Pre-existing, same as AN-P7. `guide-keys.json: 10 anchors checked`, no FAIL. | `E/check-handover.log` |
| 12 | **A28 rehearsal, no scratch-only adjustment** (`node --input-type=module < E/a28-rehearsal.script.mjs.txt`) | **0** | Seal CLI exit 0 (49.2 s); verify CLI exit 0 `REHEARSAL-PASS` (417.2 s). See below. | `E/a28-rehearsal.log` |
| 13 | `node --test --test-concurrency=1 tools/release/tests/seal.test.mjs tools/release/tests/verify-seal.test.mjs` (run 1) | **1** | 27 pass, 1 todo, 1 fail: **T-M2 (end)** only, because the working tree changed under the 28-minute run (my own mid-run edits, plus DO-E2's files). R0 and all four new DO-J2 tests pass. | `E/seal-suites.run1.log` |
| 14 | `node --test tools/release/tests/seal.test.mjs` (run 2) | **1** | 9/10: T-M2 (end) again. DO-E2's runner commit `3b72c507f` landed mid-run and emptied `git status` (§4, item 1). | `E/seal-test.run2.log` |
| 15 | `node --test tools/release/tests/seal.test.mjs` (run 3, quiet tree, `HEAD` `3b72c507f`) | **0** | **10/10**, incl. R0 and T-M2 (end), 852 s | `E/seal-test.run3.log` |
| 16 | `node tools/gates/validate.mjs --historical --stage DG6` | **0** | `PASS gate DG6 (historical)`, 5 min 22 s. Run at 14:58, after the code changes. **Not run before implementation**: protocol deviation, §4. | `E/validate-historical-DG6.log` |
| 17 | `pnpm -r typecheck` | **0** | Run 1 was OOM-killed (`apps/api typecheck: Killed`, exit 137) while four heavy jobs ran; that is not a code result. Run 2 alone: exit 0, 350 s. | `E/typecheck.log`, `E/typecheck.oom-killed.log` |
| 18 | `pnpm lint` | **0** | 92 s | `E/lint.log` |
| 19 | `pnpm openapi:lint` | **0** | — | `E/openapi-lint.log` |
| 20 | `pnpm test` (run 1, under load) | **1** | unit-node 3021/3022: `apps/api/src/p7-wiring.test.ts` timed out at 5000 ms. unit-web 2175/2175; nocodegen 259 + 2 skipped. | `E/pnpm-test.log` |
| 21 | `npx vitest run --project unit-node apps/api/src/p7-wiring.test.ts` (alone) | **0** | 3/3, 2.2 s | `E/p7-wiring.rerun.log` |
| 22 | `pnpm test` (run 2, quieter host) | **0** | unit-node 205 files / 3022 of 3022; unit-web 130 / 2175 of 2175; nocodegen 3 / 259 + 2 skipped; 349 s, at `HEAD` `3b72c507f` (the row-20 timeout did not recur) | `E/pnpm-test.run2.log` |
| 23 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **0** | "All matched files use Prettier code style!", 94 s | `E/prettier-repo.log` |

**A28 rehearsal (row 12).**

- **Inputs:**
  - real DG3.json sha256 `c906db0e0b5c7308f015e3146bc27fcd73f318d8e64a73c57261267b2c281cff`; the clone's copy has the same hash (not neutralised);
  - `secret-allowlist.json` `3cbd8b77adcaf6ed686142ce2ec094f9643a553aab73f38c77b5449a5772a970`;
  - `gate-labels-acknowledged.json` `bab2ceaefb87f2da5537786ac7f4e4ff4ae54f6c7b2487a5981c9b454821309e`.
- **Clone:** sparse clone at `4140c9828`. SYNTHETIC DG7 candidate `sha256:845ebc08153ebc070a94cfd1fd1acef9c5466525b09672c91322a579f703190a`. The synthetic `source_commit` `641d337d…` is the clone-only overlay commit of `tools/release`, as ADR-0073 §8 and DO-J specify.
- **Seal CLI (exit 0):**
  - payload archive `mth-transformation-hub-0.1.0-845ebc08153e-REHEARSAL.tar.gz`, sha256 `09c5bac82f785a5fc0b4b311a1592376c861f36ea121a78e4ca3a1749a34fd90`;
  - envelope `…-envelope-REHEARSAL.tar.gz`, sha256 `d3c96e271b6ad3b55d9443863b9ee489c719db9d82312f3516987906802e914a` (equal to `sha256sum`);
  - envelope manifest sha256 `3ad417c6f409832407e646871a9fc32e3ceb14c50a66d8e40def399c9dd2d53e`.
- **Verify CLI (`--repo`; exit 0):**
  - V1–V15 and V17 PASS: V2 72 files; V3 67 listed files; V6 eight records in chain; V7 32 review records; V9 412 register rows; V10 221 findings;
  - **V12** PASS "1 acknowledged sentence(s) in approved records: L3 docs/delivery/gates/DG3.json $.notes (entry 0)";
  - **V13** PASS "secret scan of 70 envelope files … no hit" with the real allow-list;
  - V16: DG0–DG6 BLOCKED (sparse clone omits `runs/`, ADR-0073 Residual 2; the case R0 explicitly allows) and DG7 SKIPPED. The full-repository historical validation is row 16 for DG6; DG0–DG5 were not re-run by me.
- **The comparison with DO-J's run:** there the CLI seal exited 1 (S10) and the CLI verify exited 1 (V12, V13) on the same real records. Both now exit 0 with no scratch adjustment.

## 4. Known gaps / not done

1. **Concurrency and attribution (disclosure).**
   - T-DG7-DO-E2 ran in the same tree. Its runner's auto-commit `3b72c507f` ("T-DG7-DO-E2 output", 15:36:29) swept **all of my then-uncommitted files** into DO-E2's commit, along with most of my evidence logs. That is the D-266 pattern again.
   - The content is byte-identical to my work (checksums in §3). Only the commit attribution is wrong.
   - The files in that commit that are **mine**: everything in §1 except `deploy/scripts/image-bundle.sh`, `deploy/scripts/tests/image-bundle.test.mjs`, `docs/operations/restricted-network.md` and `T-DG7-DO-E2-*`, which are DO-E2's.
   - The same concurrency caused T-M2 (end) to fail in rows 13–14 and probably the OOM kill and the 5 s timeout of rows 17 and 20. Each was re-run (rows 15, 17, 21, 22).
2. **Historical validation order (protocol deviation).** `validate --historical --stage DG6` ran once, at 14:58, after my code edits, not before implementation. It passed. DG0–DG5's historical validation was not run in the full repository by me (the rehearsal's V16 is BLOCKED for them by design).
3. **ADR text not amended.** ADR-0073 §6 does not yet mention the acknowledgement list; only this handback, the list's `$comment` and `gate-labels.mjs` describe it. ADR edits are the solution-architect's (Q1).
4. **Pre-existing failure, not mine:** `tools/release/tests/check-handover.test.mjs:420`, "T-H5 … no guides yet → BLOCKED", fails (`'PASS' !== 'BLOCKED'`). Its fixture copies the real `docs/handover/`, which has had committed `guides/` since DOC-A (`b9e5a862d`), so the "no guides yet" premise no longer holds. Owner: DOC-B / documentation (Q3). I did not change it.
5. **History-scope allow-listing.** The two history entries match on `rule + valueSha256` only (ADR-0063 §1.3 history semantics). So any S3 blob with exactly `docs/handover/deployment.md#secrets`, and any S2 blob with password exactly `x`, is accepted in history. Payload and envelope scans are unaffected. This is the narrowest available means: history cannot be reworded.
6. **The real A28 run** still exists only after DG7 approval (D-243 Q19). This rehearsal is SYNTHETIC and approves nothing. REQ-DLV-041 and REQ-S20-028 stay `completes-after-gate:`.
7. **Time:** the task overran the 60–75 minute budget (see header). The long items were the ~14–28 minute seal suites (three runs were needed because of row 13/14 interference), the 5-minute history scan and the 5-minute historical validation.
8. No live CI run (D-058). `pnpm lint` does not cover `tools/**` (pre-existing ESLint ignore, DO-J item 6). `node --check` and prettier pass on every changed file.

## 5. Open questions and merge instructions

**Open questions**

- **Q1 (solution-architect / orchestrator).** Should ADR-0073 §6 be amended with one paragraph recording the L3/L4 acknowledgement list? The amendment would state: the list is `tools/release/gate-labels-acknowledged.json`, read from the payload; it applies to DG0–DG6 records only; an entry is exact-sentence-hash, with a reason; a stale entry fails. Until then, the rule as written in the ADR would still flag the DG3 sentence, and a reviewer may judge the list against the ADR's literal text.
- **Q2 (code-security reviewer).** Please review the one acknowledged DG3 sentence and the three new `secret-allowlist.json` entries (one envelope, two history), and the S2 own-mask rule (`/^\[S\d(?:-documented)?:/` on the password part only).
- **Q3 (orchestrator → DOC-B).** Should the stale T-H5 "no guides yet" test (§4, item 4) be repaired?
- **Q4 (AN-P7, second pass, D-266 (e)).** REQ-S16-031 can be re-assessed: the payload and history scans both exit 0 (rows 2, 3). REQ-DLV-041 and REQ-S20-028 lose the O1/O2 blocker; they remain `completes-after-gate:`.

**Merge instructions**

- **Already committed by accident** in `3b72c507f` (§4, item 1). What remains to commit:
  - this handback;
  - the evidence files written after 15:36 (whatever `git status` shows under `T-DG7-DO-J2-evidence/`).
- There is no migration, contract, generated-file or `p7-pending` change. No conflict expected.
- **Before the freeze:**
  - drop the "O1/O2 unresolved" wording from progress and the register notes (AN-P7);
  - rerun `node tools/release/secret-scan.mjs --scope history` after the final commits, so committed logs are covered.
