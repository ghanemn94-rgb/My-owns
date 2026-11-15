# T-DG7-DO-E6 handback: the secret-scan hits introduced by DO-E5 (devops-engineer)

- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DO-E6.md`. Its sha256 `0809a451…a781ece` was verified at the start.
- **Invocation:** run `DG7-T-DG7-DO-E6-devops-engineer-20261115T034914Z-a84a0528`, session `a84a0528-9829-456a-8ce5-cba1cd58597f`.
- **Stage and base:**
  - DG7 (BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`;
  - base `HEAD` at start was `19312f1e8e3c2b14e5c4e30873e05897b997d204`;
  - the working tree at start was clean apart from this run's own `runs/` directory.
- **Time:** `date -u` at start `Sun Nov 15 03:49:28 UTC 2026`; at end `Sun Nov 15 04:13:19 UTC 2026` (about 24 minutes).
- **Environment:**
  - this sandbox, Linux, Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin` first on `PATH`), offline (`MTH_PNPM_OFFLINE=1`);
  - PostgreSQL only through `tests/qa/support/with-pg.sh` (one disposable cluster, port 24671);
  - no Docker daemon used or needed (D-243 Q1);
  - 11 GB disk free at start; no extra checkout or clone was made.
- **Ran alone:** no other run's files appeared in `git status` during this task.

This handback approves nothing. Allow-listing a value grants no business, Finance or IT approval. Product gate G6 does not imply engineering gate DG7, and DG7 does not imply any product gate G1–G6.

Per the assignment, this handback does **not** quote any matched text verbatim. Values are identified only by rule, location and SHA-256.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `deploy/scripts/tests/dockerfile-context.test.mjs` | Payload hit (S2, l.191). The comment no longer spells a scheme/user/password/host URL; it now describes the value in words ("a real credential-bearing proxy URL (scheme, user, password, host and port)"). The code is unchanged: the runtime-assembled URL and the assertions on it are as DO-E5 left them. File sha256 `98ceb1b4…6634c`. |
| `docs/delivery/handbacks/DG7/T-DG7-DO-E5-devops-engineer.md` | History hit (S2, l.29), an implementer document. The sentence now names the URL's parts (scheme, user, the test's `PROXY_PASSWORD` constant, host, port) instead of spelling the URL. A parenthesis records that T-DG7-DO-E6 changed the wording and why. Nothing else in the file changed. File sha256 `d547755e…bfdbc`. |
| `tools/release/secret-allowlist.json` | Two new `scopes: ["history"]` entries, in the form DO-J2 used, each with a reason (§2). The file had 44 entries before and has 46 now; no existing entry changed. File sha256 `6033d4e1…50f27`. |
| `docs/delivery/handbacks/DG7/T-DG7-DO-E6-evidence/**` | Check logs (§3). |
| `docs/delivery/handbacks/DG7/T-DG7-DO-E6-devops-engineer.md` | This handback. |

Not changed:

- No scanner rule changed: `tools/release/secret-scan.mjs` and `tools/release/lib/patterns.mjs` are untouched (`git diff HEAD -- tools/release/secret-scan.mjs tools/release/lib` is empty).
- The DO-E5 run record (`docs/delivery/runs/DG7/DG7-T-DG7-DO-E5-…/result.json`) is not touched. Run records are write-once.
- No gate record, review record, `tools/gates/**`, `stages.json`, `findings.json` or `test-evidence/**` was touched.
- No `p7-pending` entry belongs to this task. There is no migration, contract, permission or product-code change.

## 2. Behaviour per requirement

**REQ-S16-031 (repository secret scan); pre-freeze run 2, T-G2.**

**Payload hit, reworded (D-266 (b)).** S2 matched the comment at `dockerfile-context.test.mjs:191` (value sha256 prefix `5e884898da28`).

- The new comment no longer has the scheme, separator, user, password and at-sign sequence that S2 matches. The payload scan exits 0 (§3, row 1), and a `--path` scan of the three changed files is clean (row 3).
- The test still proves what DO-E5 built:
  - `build-image.sh` receives a real credential-bearing proxy URL;
  - the URL's value never appears in its output;
  - Docker is never called.

  14/14 pass (row 5).

**History-only hits, allow-listed.** Git history cannot be rewritten and run records are write-once, so these two entries are added. Both are `scopes: ["history"]` only, so they do not apply to payload or envelope scans.

1. **S2, `deploy/scripts/tests/dockerfile-context.test.mjs`, value sha256 `5e884898…1542d8`.**
   - This is the generic placeholder word that the old comment used in the password position. It remains in the earlier blobs of that file.
   - It is documentation text, not a credential. The current file is reworded, so no payload entry is needed.
2. **S2, `docs/delivery/**`, value sha256 `bfadce1a…b4b422`, `firstSeen` the DO-E5 handback.**
   - This is the synthetic four-character test password of the unreachable `proxy.example` proxy URL. It is quoted in the earlier blobs of DO-E5's handback (l.29) and in DO-E5's write-once run `result.json`.
   - It is a test fixture value, not a credential.
   - The handback is now reworded. The run record cannot be.
   - Neither file is in the payload or the envelope. The envelope lists gates, candidate manifests, reviews, agent definitions, `test-evidence/DG7/` and extras (`tools/release/lib/envelope.mjs`), not `handbacks/` or `runs/`. So no envelope entry is needed.

**What the history entries cover, and what they don't:**

- ADR-0063 §1.3 history semantics: in history scope an entry matches on `rule + valueSha256` only (`secret-scan.mjs` l.370), not on path. DO-J2's §4 item 5 describes the same property.
- So any S2 history blob whose password part has exactly either of these two values is accepted in history. Both values are well-known non-secrets.
- A different value, or any payload or envelope occurrence, is still a hit.
- The `path` fields still document where each value lives.

**Why no scanner change.** The prefreeze logs quote the scanner's own mask. DO-J2's existing own-mask rule already clears that. No other hit remained after the two entries (row 2).

**No new hits from this task.** The reasons in the two entries, this handback and the evidence logs avoid quoting the values. A `--path` scan of the handback and evidence directory is clean (row 12), so committing them adds no history hit. This run's own transcript does quote the two old lines, because I printed them while inspecting. The only S2 values in those lines are the two values above, so the value-wide history entries already cover the transcript once it is committed. The transcript also contains my first draft of this handback. That draft had one S2 match: a generic four-letter placeholder password, value sha256 `d74ff0ee…82e8f1`, caught by the first own-files scan (`E/secret-scan-own-files.attempt1.log`, masked). I reworded it before anything was committed. In history scope that value is already accepted value-wide by the existing entry for `apps/api/test/integration/assistant/settings.test.ts` (default scopes payload and history). The same entry is why the assignment file's own wording passes the history scan. The history re-run before the freeze (§5) confirms all of this.

## 3. Checks run (real exit codes)

Node 24.21.0, offline. Logs are in `docs/delivery/handbacks/DG7/T-DG7-DO-E6-evidence/` (abbreviated `E/`). All rows ran on the working tree described in §1, at `HEAD` `19312f1e8` (uncommitted edits).

| # | Command | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| 1 | `node tools/release/secret-scan.mjs --scope payload` | **0** | `secret-scan: PASS (payload; 3146 files; allowed 33; canary (documented) 22)`, 7 s. A first attempt at 03:50 wrote no log because the log directory did not exist yet (my own command-ordering race); the scan was re-run at 03:53. | `E/secret-scan-payload.log` |
| 2 | `node tools/release/secret-scan.mjs --scope history` | **0** | `secret-scan: PASS (history; 35675 files; allowed 243; canary (documented) 46)`, 164 s, started 03:50:30. The run reports no stale entry, so both new entries are used. | `E/secret-scan-history.log` |
| 3 | `node tools/release/secret-scan.mjs --path deploy/scripts/tests/dockerfile-context.test.mjs --path docs/delivery/handbacks/DG7/T-DG7-DO-E5-devops-engineer.md --path tools/release/secret-allowlist.json` | **0** | `PASS (path; 3 files; allowed 0; …)` | `E/secret-scan-changed-paths.log` |
| 4 | `node --test tools/release/tests/secret-scan.test.mjs tools/release/tests/patterns.test.mjs tools/release/tests/security-controls.test.mjs` | **0** | 131/131, 22 suites, 179 s. Includes T-G1 (the rules, the allow-list and masking) and T-G2: `--scope payload exits 0` and `--scope history exits 0`, the two cases that failed in pre-freeze run 2. | `E/secret-scan-tests.log` |
| 5 | `node --test deploy/scripts/tests/dockerfile-context.test.mjs` | **0** | 14/14 | `E/dockerfile-context.test.log` |
| 6 | `node tools/gates/validate.mjs --historical --stage DG6` | **0** | `PASS gate DG6 (historical)`, 136 s. It ran after the three small edits, not before them (§4, item 1). | `E/validate-historical-DG6.log` |
| 7 | `pnpm -r typecheck` | **0** | 298 s | `E/typecheck.log` |
| 8 | `pnpm lint` | **0** | 39 s | `E/lint.log` |
| 9 | `pnpm openapi:lint` | **0** | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` | `E/openapi-lint.log` |
| 10 | `pnpm test` | **0** | unit-node 206 files / 3036 tests; unit-web 130 / 2179; nocodegen 3 / 259 + 2 skipped; 358 s | `E/pnpm-test.log` |
| 11 | `QA_PG_PORT=24671 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | **0** | 111/111, 105 s. I touched no integration test; this is the contract test the acceptance names. | `E/contract.integration.log` |
| 12 | `node tools/release/secret-scan.mjs --path docs/delivery/handbacks/DG7/T-DG7-DO-E6-devops-engineer.md --path docs/delivery/handbacks/DG7/T-DG7-DO-E6-evidence` (after this handback was written) | **0** | `PASS (path; 14 files; allowed 0; …)`. Attempt 1 exited **1** on one S2 match in my own draft; it was reworded (§2). | `E/secret-scan-own-files.log`, `E/secret-scan-own-files.attempt1.log` |
| 13 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (after this handback was written; the `date -u` at end is in the same log) | **0** | "All matched files use Prettier code style!", 93 s, ended `Sun Nov 15 04:13:19 UTC 2026`. After this table was filled in, only this handback changed, and `npx prettier --check` on it exits 0. | `E/prettier-repo.log` |

## 4. Known gaps / not done

1. **Historical validation order (protocol deviation).** `validate --historical --stage DG6` ran once, after the edits, instead of before implementation. It passed (row 6). The edits are a comment, one handback sentence and two allow-list entries; none of them is a file the DG6 validator reads.
2. **History allow-listing is value-wide in history scope** (§2). This is the narrowest means the scanner offers, and it is the same as DO-J2's entries.
3. **Not re-run by me:** the seal suites (`seal.test.mjs`, `verify-seal.test.mjs`) and the rest of `tools/release/tests/**`. The change does not reach their code paths except through the allow-list, and V13/S10 use envelope scope, which the new history-only entries do not affect. The pre-freeze run will re-run them.
4. **Reading.** I read the work split's §2 shared rules (rule 5 masking, rule 6 planted values), §G's secret-scan rows, D-266 and the D-243-onward decisions as they bear on secret-scan handling, DO-J2's handback, and the scanner's allow-list code. I did not read the whole of `p7-plan.md` or every ADR the work split cites; nothing in this task depends on them beyond ADR-0063 §1.3, which the scanner implements and DO-J2 documents.
5. No live CI run (D-058).

## 5. Open questions and merge instructions

**Open questions**

- **Q1 (code-security reviewer).** Please review the two new history-only entries in `secret-allowlist.json` (S2 `5e884898…`, S2 `bfadce1a…`) and the reworded comment.
- **Q2 (orchestrator).** The orchestrator can add a short "do not spell a credential-bearing URL in comments or handbacks" line to the next devops assignments. That would stop the reword-then-allow-list cycle (AN-P7 → DO-J2 → DO-E5 → DO-E6).

**Merge instructions**

- Commit the three changed files, this handback and `T-DG7-DO-E6-evidence/`.
- There is no migration, contract, generated-file or `p7-pending` change. No conflict is expected.
- Before the freeze, re-run `node tools/release/secret-scan.mjs --scope history` after the final commits, so that the committed logs and run records (including this run's transcript) are covered.
