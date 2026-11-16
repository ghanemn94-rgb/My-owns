# Handback T-DG7-DO-B (devops-engineer): slice G, secret scan, claims scan, controls matrix

- **Stage:** P7 / DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`, base `HEAD` `1b312be3633a0d16f9ffc943cd551e7ec8f66452` (verified with `git rev-parse HEAD` at start; working tree clean except this run's own `docs/delivery/runs/DG7/…` directory).
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DO-B.md` (sha256 `300d920c…f49b42f219dccc`, verified). Work split §G.1 of `docs/architecture/p7-work-split.md`; ADR-0063; D-243, D-244.
- **Invocation:** run `DG7-T-DG7-DO-B-devops-engineer-20261112T161103Z-5246b9d2`, session `5246b9d2-952d-4315-9adc-d5b2c8ad397f`.
- **Time:** started 16:11:12Z, finished 16:52Z (about 41 minutes; within the 60–75 minute budget).
- **Environment** (`T-DG7-DO-B-evidence/00-environment.txt`):
  - Node v24.21.0, pnpm 10.33.0, git 2.43.0, OpenSSL 3.0.13, PostgreSQL 16.15, uid 0, kernel 6.18.44;
  - offline (`MTH_PNPM_OFFLINE=1`);
  - Docker CLI present but `docker info` exits 1 (no daemon reachable; D-243 Q1). Nothing in this task needs a container.
- **Nothing here is an approval.** The scans and the matrix are engineering evidence. They grant no G1–G6 business approval, and they neither touch DG7 nor imply it. Mobily IT's assessment of the matrix is external.

## 1. Changed files (all new; nothing outside §G.1 was edited)

| File | Purpose |
| --- | --- |
| `tools/release/secret-scan.mjs` | ADR-0063 §1: the scopes `payload` (default), `history`, `--path`, `--scope envelope --list`; rules S1–S6; masking; exit codes 0/1/2. Module API `scanSecrets({ scope, repo, paths, list, allowlist }) → { ok, scope, hits, allowed, canaries, files, skipped, stale }` (DO-J, slice I). Also exports `scanContent`, `loadAllowlist`, `report`, `SecretScanBlocked`. |
| `tools/release/claims-scan.mjs` | ADR-0063 §3: groups D and U; rules K1–K4; `--root`, `--show-negated`, `--allowlist`. Module API `scanClaims({ repo, roots, allowlist }) → { ok, hits, negated, allowed, files, counts: { D, U }, stale }`. Imports `claimsOfficialPmi`/`PMI_CLAIM_PATTERN` from `packages/shared/src/text-scan/claims.ts` through Node 24 type stripping; a failed import is BLOCKED (exit 2), and there is no fallback copy. |
| `tools/release/lib/claims-rules.mjs` | `CONFORMITY_WORDS`, `CONFORMITY_WORDS_AR`, `ASSERTION_WORDS`, `FRAMEWORKS`, `CERTIFIED_ADJECTIVES(_AR)`, `PRODUCT_NOUNS(_AR)`, `NEGATIONS`, `NON_CLAIM_OBJECTS`, the sentence splitter, and the TS and SQL string-literal tokenizers. |
| `tools/release/secret-allowlist.json` | 41 entries: 25 with scopes `payload+history`, 16 with `history+envelope`. Each has a reason and a value hash, never a value (§4.1). |
| `tools/release/claims-allowlist.json` | 19 entries, all engineering records in `docs/architecture/**` or the register, each with a reason (§4.2). |
| `tools/release/tests/secret-scan.test.mjs` | T-G1, T-G2, T-G3 |
| `tools/release/tests/claims-scan.test.mjs` | T-G4, T-G5, T-G6 |
| `tools/release/tests/security-controls.test.mjs` | T-G7, T-G8 |
| `tools/release/tests/fixtures/secrets/non-matches.txt`, `…/env-template-ok.env` | Synthetic non-match and template fixtures. The planted values are assembled at run time from fragments in the test files. |
| `tools/release/tests/fixtures/claims/non-claims.md` | Negated twins (en, ar), the non-claims of Context 4, the M0332 sentence and B0110. |
| `docs/handover/security-controls.md` | ADR-0063 §4: the §4.1 header verbatim; Section 1 SC-01…SC-17 with every test path verified; Section 2 HR-01…HR-07. |
| `packages/db/test/integration/db-tls.test.ts` | T-G9 (HR-02): a TLS-only scratch PostgreSQL cluster with a throwaway CA under `$TMPDIR`, on a port from `pg-port.sh` `mth_port_pick`. It goes through the product's own `createPool`. |
| `tools/release/ci/secret-scan.job.yml` | The CI job fragment (ADR-0063 §1.5) with merge instructions, for the orchestrator. |
| `docs/delivery/handbacks/DG7/T-DG7-DO-B-evidence/**` | Logs `00`–`13` (see §3). |

## 2. Behaviour delivered, per requirement

- **REQ-S16-031 "the secret scan finds no secrets in the repository":**
  - payload: PASS, 2,856 files, 34 allowed, 16 documented canaries, 5 s;
  - history: PASS, 33,263 blobs reachable from `HEAD` (each blob once, `trading_agent/` excluded), 213 allowed, 28 documented canaries, 114 s;
  - T-G1 proves that the scan works and T-G2 proves that the real tree and history are clean.
- **REQ-S16-031 "the environment template contains placeholders only":** S5 passes over the real `.env.example`. A value (`NODE_ENV=production`), a quoted empty value (`X=""`) and a lower-case name each fail (T-G3).
- **REQ-S16-031 "a CI secret scan blocks committed secrets" (procedure):**
  - the fragment adds a `secret-scan` job after `delivery-gates`, with `fetch-depth: 0`, payload, then history, then the self-tests;
  - `verify`, `dependency-audit` and `release` get `needs: [delivery-gates, secret-scan]`;
  - merged into a scratch copy of `deploy/ci/ci.yml`, `check-ci-needs.mjs` exits 0 (8 jobs);
  - I ran the job's three commands locally (logs `03`, `04`, `02`), all exit 0;
  - **live CI has not been run (D-058).**
- **REQ-S16-031 "the deployment guide documents TLS and encryption integration":** matrix Section 2 (HR-01…HR-07) exists. DOC-B's guide link to it is still to come (ADR-0072).
- **HR-02 database TLS:** T-G9 **ran and passed** (4/4, PostgreSQL 16.15):
  - `sslmode=verify-full` plus `sslrootcert` connects, and `pg_stat_ssl.ssl` is true with TLS 1.2 or 1.3;
  - without the CA the connection is refused (the certificate does not verify);
  - plaintext is refused by the TLS-only cluster;
  - `NODE_EXTRA_CA_CERTS` (the Compose route for `MTH_EXTRA_CA_CERTS_FILE`) verifies the server, and without it the child process fails.
  
  This is a test of the integration point against a scratch cluster, **not** of Mobily's database service. The matrix says so.
- **REQ-S16-033 "a text scan of docs and UI strings finds no compliance or certification claim":** PASS over 805 files (D 105, U 700; 26 negated, 19 allowed), 3 s.
  - T-G4 and T-G5 show that the scan works. T-G5 is K1 parity on all 43 `CLAIM_CORPUS` samples.
  - T-G6 shows that the real text is clean.
  - The A28 re-run over the archive's `docs/` belongs to DO-J at the seal. `scanClaims({ roots })` supports it, and repository allow-list entries match archive copies by path suffix (tested).
- **REQ-S16-033 "the matrix links each control to a test":** T-G7 and T-G8 pass (101 assertions). Every Section 1 row links existing test files. Every Source id resolves to an anchor or a register id, every Section 2 guide link resolves, and the header equals ADR-0063 §4.1. SC-01's register id is REQ-S16-030 (D-244 O7).
- **REQ-S21-003 (slice I):** `scanSecrets({ scope: "path", paths })` and the `--path` CLI are ready for the handover text before commit.

## 3. Checks actually run (exact commands, real exit codes)

All runs used Node v24.21.0 from `/opt/nvm/versions/node/v24.21.0/bin`, `MTH_PNPM_OFFLINE=1`, in the repository root, at base `1b312be3…`. The new files were in the working tree and not committed.

| # | Command | Exit | Result | Log |
| --- | --- | --- | --- | --- |
| 1 | `env -u LANG -u LC_ALL node --test tools/release/tests/*.test.mjs` | **1** | 234 tests: 231 pass, **1 fail**, 2 skipped (126 s). Every T-G1…T-G8 test passes. The failure is **DO-A's T-A5**, not in this task's files: pnpm gets `EROFS` symlinking into `/root/.local/share/pnpm/store` (HOME is read-only in this agent sandbox), so the install step exits 226. | `01-node-test-release.log` |
| 2 | `LC_ALL=C.UTF-8 LANG=C.UTF-8 node --test tools/release/tests/secret-scan.test.mjs tools/release/tests/claims-scan.test.mjs tools/release/tests/security-controls.test.mjs` | 0 | 191/191 pass (119 s, includes the history scan) | `02-node-test-do-b-C.UTF-8.log` |
| 3 | `node tools/release/secret-scan.mjs` | 0 | `secret-scan: PASS (payload; 2856 files; allowed 34; canary (documented) 16)` | `03-…` |
| 4 | `node tools/release/secret-scan.mjs --scope history` | 0 | `secret-scan: PASS (history; 33263 files; allowed 213; canary (documented) 28)`, 114 s | `04-…` |
| 5 | `node tools/release/claims-scan.mjs` | 0 | `claims-scan: PASS (805 files; D 105, U 700; negated 26; allowed 19)` | `05-…` |
| 6 | `node tools/release/claims-scan.mjs --show-negated` | 0 | All 26 negated sentences listed. I reviewed each one: every one is a disclaimer or a rule description. | `06-…` |
| 7 | `tests/qa/support/with-pg.sh pnpm vitest run --project integration packages/db/test/integration/db-tls.test.ts` | 0 | 4/4 pass (TLS cluster on a pool port; harness PostgreSQL 16.15) | `07-db-tls.log` |
| 7b | `pnpm vitest run --project integration packages/db/test/integration/db-tls.test.ts` (the work split's bare command) | 1 | `BLOCKED: no database`: the integration project's global setup needs `TEST_DATABASE_ADMIN_URL`, hence row 7 | `07b-…` |
| 7c | as row 7 with `env PGBIN=/nonexistent` | 1 | All 4 tests fail with `BLOCKED: PostgreSQL server binaries not found (set PGBIN)`, never a pass (negative control; not kept as a log) | — |
| 8 | `node deploy/scripts/check-ci-needs.mjs <scratch ci.yml with the fragment merged>` | 0 | `OK: … 8 jobs`. The merge is kept as a unified diff against `deploy/ci/ci.yml` (`08-ci-merged-scratch.diff`, plus the scratch file's sha256), so no CI throwaway value is copied into the evidence. The base `deploy/ci/ci.yml` also exits 0 (7 jobs). | `08-…` |
| 9 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | All matched files use Prettier code style | `09-…` |
| 10 | `pnpm lint` | 0 | eslint `--max-warnings=0` clean | `10-…` |
| 11 | `pnpm --filter @mth/db typecheck` | 0 | `tsc` clean (two TS4111 errors in the new test fixed first) | `11-…` |
| 12 | `node tools/gates/validate.mjs --historical --stage DG6` | 0 | `PASS gate DG6 (historical)` | `12-…` |

Checksums of the deliverables are in `13-sha256-deliverables.txt`.

## 4. Allow-list entries (confirmed from real runs)

### 4.1 Secret scan (41 entries; values never stored)

**Payload and history (25 entries):**

- **Redaction fixtures (ADR-0063 Context 3),** reason "synthetic redaction-test fixture (truncated, not a credential)":
  - S1 values `457643f44d19` (`AKIA…`), `8bcac7908eb9` (an RSA private-key block header) and `c373e853cf93` (JWT);
  - files: `apps/worker/src/exception-redaction.test.ts`, `apps/api/test/integration/operations/exceptions.test.ts`, `packages/config/src/redaction.test.ts`.
- **`ci-only-not-a-secret`** (S2 `0d86f34eec66`): in `deploy/ci/ci.yml`, `.github/workflows/ci.yml` and `docs/architecture/ci/ci.yml`. The third is a copy of the workflow kept with the architecture docs.
- **Synthetic credential-URL fixtures of tests (S2):**
  - files: `packages/config/src/load.test.ts`, `packages/db/src/demo/guard.test.ts`, `apps/api/test/integration/{assistant/settings,integrations/connectors,operations/exceptions}.test.ts`, `apps/worker/src/exception-redaction.test.ts`;
  - ADR-0063 Context 3 quotes the same fixture URL.
- **Synthetic token fixtures of tests (S3):** `apps/api/test/integration/integrations/connectors.test.ts`, `apps/web/src/app/p6-shell.test.tsx`, `apps/web/src/pages/admin/security/p6-admin-screens.test.tsx`.
- **Canaries quoted in the operations guide (S4):** `docs/operations/monitoring.md` documents the log-scan procedure. Under ADR-0063 S4 that file is not a test or CI path.

**History and envelope only (16 entries, path `docs/delivery/**`).** These are quotes in approved records, which are never rewritten (D-243 Q13):

- six log-scan canaries (S4);
- six code fragments that S3 sees as values in JSON-escaped transcripts and logs: type names, member expressions, an eslint rule name;
- **four notification deep-link tokens (S3)** in `docs/delivery/test-evidence/DG6/qa/T-DG6-QA-B-authoring/e2e-run{1,2}.log`. These are random 43-character tokens that a DG6 QA e2e run printed from its disposable database (`UPDATE inbox_notification SET link_token = …`). The database was destroyed with the run, and they are not credentials to any lasting system. **I am reporting them to the orchestrator as D-243 Q13 asks (open question O1).**

**No real secret was found.** I judged each distinct value from its rule, shape (prefix of 10 or fewer characters, length, entropy) and file. I never printed a value whole.

### 4.2 Claims scan (19 entries)

- **ADR-0049** (8): the DG5 rule's own description; the M0089 quote; one "neither … nor the product is" disclaimer.
- **`data-dictionary.md`** (1): the rule description.
- **`docs/architecture/README.md`**: none needed (handled by the K1 claim-verb negation, §5 D4).
- **ADR-0061** (1) and **ADR-0005** (1): a third-party library marked UNVERIFIED and "not a claim about this product".
- **`p5-plan.md`** (1) and **`p5-work-split.md`** (2): descriptions of the P5 scan.
- **ADR-0063** (2) and **`p7-work-split.md`** (1): descriptions of what this scan detects. The ADR wanted these files to pass by being rephrased (open question O2).
- **The register** (3): the REQ-PB-001 texts and the REQ-S21-004 "Completion attestation" title.

No entry covers `docs/handover/**` or group U. The loader refuses both, and the tests prove it.

## 5. Deviations from the work split and ADR-0063, with reasons

1. **D1, Markdown sentences:** soft-wrapped paragraph lines are joined into one unit before sentences are split. A heading, a list item, a quote, a table cell or a code-fence line still starts a new unit.
   - ADR §3.2 says "a newline in Markdown prose".
   - Splitting at the wrap cut negations away from their claims ("This product is not an / official PMI standard…"), which produced false hits, and it would hide a claim wrapped across two lines.
   - The reported line is the sentence's own line.
2. **D2, Arabic K2 list:** the forms of و-ف-ق (متوافق …) and ع-م-د (معتمد …) are scored like English "aligned/compatible" and "approved". They are in `ASSERTION_WORDS` (K3, next to a named framework), and ع-م-د is also in `CERTIFIED_ADJECTIVES_AR` (K4).
   - With them in K2, the product's Arabic for "approved by Finance" (معتمدة من المالية), "approver" (المعتمِد) and "S3-compatible" (متوافق مع S3) gave 26 false hits.
   - K2 keeps ط-ب-ق, م-ث-ل and شهادة.
   - A conformity claim that names a framework is still caught by K3, which the T-G4 ar fixtures show.
3. **D3, `NON_CLAIM_OBJECTS`:** a K2 hit whose governed object is playbook B0110's "new process" (العملية الجديدة) is not a claim.
   - "Compliance with new process" is verbatim playbook text (B0110), seeded in `0047` and `0092` (group U). Applied migrations cannot be rephrased.
4. **D4, K1 claim-verb negation:** before `claimsOfficialPmi` (unchanged) is applied, a PMI phrase that is the object of "not/never claim(s)" or "nothing … claims" is removed. This is the same removal the DG5 rule does for its own negations.
   - It lets through the API's problem texts "… must not claim official PMI status …" (group U, not allow-listable).
   - T-G5 proves that the verdict still equals `claimsOfficialPmi` on all 43 corpus samples, including "No PMI endorsed claim, but certified by PMI." (still a claim).
   - Negated K1 sentences are counted and listed by `--show-negated`.
5. **D5, SQL `RAISE` literals:** these are skipped. They are PL/pgSQL error format strings, not seeded texts, and the API maps them to its own problem texts, which are scanned. `0089`'s guard message describes the PMI rule.
6. **D6, S3 refinements beyond ADR §1.2.** The first real run had 124 hits, almost all code, so S3 also ignores:
   - in code files, an unquoted value (an expression);
   - values with whitespace (prose, i18n messages);
   - `$`/`${` expansions;
   - YAML/JSON flow collections (Compose `secrets: [names]`, a protected path);
   - `mth-canary-` values (S4's business);
   - self-declared markers (`synthetic|example|not-a-secret|not-used|dummy|placeholder`; S3 only, never S1 or S2);
   - namespaced lower-case identifiers (`mth.automation.restricted-token.v1`, `virtual:x.css`, `a/b.ts`);
   - member expressions;
   - JSON-escaped fragments (`\n` inside the value).
   
   Two narrower rule changes go with these:
   - the key word `secret` does not match `secretary`;
   - S2 leaves `mth-canary-` passwords to S4, and S4 needs at least one character after the prefix.
   
   Each exclusion is covered by a T-G1 non-match case. The residual is that a real secret shaped like one of these, for example one containing "example", is not reported by S3. S1 and S2 still apply to it.
7. **D7, allow-list fields:**
   - **Secret allow-list:** an optional `scopes` field (default `["payload","history"]`) lets delivery-record quotes live in `history+envelope` only. An informational `firstSeen` field is ignored by the loader.
   - **Stale entries:** these fail for the whole-repository scopes (payload, history). In the subset scopes (`--path`, envelope), only an entry with a literal path whose file was scanned can be stale. Otherwise every `--path` run over `demo-data/` would fail on unrelated entries.
   - **Claims allow-list:** paths must be literal. Under `--root` an entry matches the archive copy by path suffix and is stale only if its file was scanned.
   - **A missing allow-list file** is BLOCKED (exit 2) in both scans. The ADR does not cover this case.
8. **D8, matrix:**
   - **Evidence column:** `—` in every row, because recorded gate evidence is not in the handover archive and a path would not resolve there at the A28 re-run.
   - **Deployment guide (ADR-0072):** it does not exist yet, so it is named in plain text. The link that resolves goes to the existing `docs/operations/*.md` guide.
   - **HR-04:** links `configuration.md` until the deployment and backup guides exist.
   - **SC rows:** a few tests beyond the ADR's list were added, all verified to exist:
     - SC-03: `aud-write-deny`;
     - SC-05: `invalid-character`, `invalid-utf8`, `blank-text`, `response-validation`;
     - SC-07: `security-source-scan`, `platform.test.ts` CSP;
     - SC-10: `preview`;
     - SC-11: `licenses/tests/{direct-dependencies,runtime-licences}`;
     - SC-14: `exception-redaction`;
     - SC-16: `packages/db/test/integration/protection.test.ts`.
9. **D9, CI fragment:**
   - The fragment is wrapped in `jobs:` so the file is valid YAML that passes Prettier on its own.
   - Its self-test step re-runs T-G2, so history is scanned twice in that job, and once more in DO-A's `release` job, which runs `tools/release/tests/*.test.mjs`. That is about 2 minutes each time. I left it this way rather than add a skip pattern (open question O4).
10. **D10, T-G9 command:** it runs through `tests/qa/support/with-pg.sh` because the `integration` project's global setup needs `TEST_DATABASE_ADMIN_URL`. The bare command in §G.4 exits 1 with `BLOCKED: no database` (row 7b).

## 6. Open questions for the orchestrator

- **O1:** The four DG6 QA e2e deep-link tokens (§4.1) are allow-listed for history and envelope with a reason. Confirm or decide otherwise. They are not credentials, and the records are approved and never rewritten (D-243 Q13).
- **O2:** ADR-0063 (lines 48 and 140) and `p7-work-split.md` (line 66) were to pass T-G6 "by rephrasing rather than allow-listing". I cannot edit them, so they have three allow-list entries. If the architect rephrases them, the entries go stale and the scan fails until they are removed. That is intended.
- **O3:** Please add this line to DOC-B's `docs/handover/README.md` index (work split §2 rule 10): `| [security-controls.md](security-controls.md) | Security controls: evidence for Mobily IT's assessment (product controls with their tests; hosting responsibilities) |`.
- **O4:** CI duplication of the history scan (D9). Keep it, or skip T-G2 in the job's self-test step.
- **O5:** When DOC-B's deployment guide exists, HR-01, HR-02, HR-04 and HR-06 should link it, and HR-04 should also link the backup guide (ADR-0066). The matrix is my file, so the orchestrator needs to assign that edit. T-G7 will check the new links.
- **O6:** DO-A's T-A5 fails in this agent sandbox because the pnpm store under HOME is read-only (row 1). It is outside my files. It needs a run on a host with a writable store.

## 7. Known gaps and residuals (stated plainly)

- **Live CI of the `secret-scan` job has not been run (D-058).** Only the static check and a local run of its commands were done.
- **Both scans are pattern-based** (ADR-0063 §5 residual 1). D2, D4 and D6 widen what passes, and each widening is listed above.
- **Arabic مطابقة** also means "matching" (UI: "لا توجد صفوف مطابقة للتصفية"). That string passes only because it is negated. A future UI string such as "صفوف مطابقة للتصفية" would be a false K2 hit and would have to be rephrased.
- **The matrix's Arabic summary** is ADR-0063's provisional text, not checked by a qualified reviewer.
- **History scope covers `HEAD`'s ancestry only** (ADR-0063 §5 residual 3). My new files are not committed yet, so they enter history only at the integration commit. Their content passed the payload scan.

## 8. Merge instructions

- No migration, lock, operation, permission or i18n key. Only new files, so no conflicts are expected.
- The orchestrator merges `tools/release/ci/secret-scan.job.yml` into `deploy/ci/ci.yml` and `.github/workflows/ci.yml` after DO-A's W2 change:
  - insert the job after `delivery-gates`;
  - make `verify`, `dependency-audit` and `release` need `[delivery-gates, secret-scan]`;
  - run `node deploy/scripts/check-ci-needs.mjs`.
- After the integration commit, re-run `node tools/release/secret-scan.mjs --scope history` to confirm history with these files committed. I expect PASS: the evidence logs hold masked values only, and the merge is kept as a diff without CI values.
