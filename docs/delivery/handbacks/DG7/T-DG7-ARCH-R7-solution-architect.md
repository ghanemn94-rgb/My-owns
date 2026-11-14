# Handback T-DG7-ARCH-R7 (solution-architect): pre-freeze ADR amendments

- **Stage:** DG7 (P7 "Independent transfer and release", BUILDING), branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `HEAD` `f0b09b34760e4bf8389b6eeb1f9f39a18b21c08c`. At the start the working tree was clean except for this run's own `docs/delivery/runs/` directory.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-ARCH-R7.md`, sha256 `8041672f…a11f8`, verified.
- **Invocation:** run `DG7-T-DG7-ARCH-R7-solution-architect-20261114T182501Z-56374919`, session `56374919-9683-4b51-858a-c696cf077fb6`.
- **Time:** started 2026-11-14T18:25:12Z (`date -u`). The end time is in §3.
- **What I read:**
  - p7-work-split §1–§2;
  - ADR-0069 (all, including Amendment 1), ADR-0065 (all), ADR-0073 §6, ADR-0063 §1.2–§1.3;
  - D-243 and D-262–D-267;
  - the DO-E4, BE-F2 and DO-J2 handbacks;
  - host runs 2, 3, 3b and 3c with `00-env.log`;
  - the shipped code that each amendment describes: `image-bundle.sh`, `checkBundle`/`createExport`, `UNPORTABLE_BUNDLE_KINDS`, `gate-labels.mjs`/`verify-seal.mjs` V12, `secret-scan.mjs` scopes and `OWN_MASK`.
- **Not read:** of p7-plan, only the sections that the ADRs cite. I did not reread the whole file.
- **Scope:** documentation only. Nothing here grants a business, Finance or IT approval. Product gate G6 does not imply DG7, and DG7 does not imply any product gate.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `docs/architecture/adr/ADR-0069-p7-clean-deployment-base-url-readiness-transfer-offline-image-drills.md` | **Amendment 2** (A2.1–A2.3), plus in-place pointers in §6, §7 and A1.2 rule 3. It covers: `save` tags on the connected host, and `load`/`verify` never tag; host run 2 corrects A1.2's store-model claim; where the Keycloak e2e runs, and without the host's proxy variables; the residual updates. |
| `docs/architecture/adr/ADR-0065-p7-configuration-transfer-bundle-schema-version-drafts-publish-pipeline.md` | **Amendment 1** (A1.1–A1.3), plus pointers in §1 (the `automation_rule` row), §2, §6 and Residual 1. It covers: the missing-version rule and the `ConfigBundle` contract change (confirmed); `automation_rule` is out of scope for DG7 and refused explicitly; the open owner questions for a later adapter. |
| `docs/architecture/adr/ADR-0073-p7-release-envelope-a28-sealing-verify-final-report-a26-a27-drills.md` | **Amendment 1** (A1.1–A1.2), plus a pointer in the last bullet of §6. It records the V12 L3/L4 acknowledgement list `tools/release/gate-labels-acknowledged.json`. |
| `docs/architecture/adr/ADR-0063-p7-secret-hygiene-claims-scan-security-controls-evidence.md` | **Amendment 1** (A1.1–A1.4), plus pointers in §1.2 S2 and §1.3. It covers: allow-list `scopes`; the S2 exclusion of the scanner's own mask; DO-J2's two history-only entries. This is where DO-J2's history allow-list question belongs (see §2.3). |
| `docs/delivery/handbacks/DG7/T-DG7-ARCH-R7-evidence/*.log` | The check logs of §3. |
| this handback | — |

No code, test, contract, migration or `p7-pending*.ts` file changed. The assignment is documentation only, so no pending entry belongs to it, and no mutation was added: there are no new authorization, validation, concurrency or audit obligations.

## 2. Behaviour per question (decisions recorded)

### 2.1 ADR-0069: "never re-tags" vs DO-E4; the Keycloak e2e and the proxy (Amendment 2)

- **Decided: DO-E4's approach stands, and the ADR changes.**
  - `save` checks that the id of `<ref>:<tag>@<digest>` is the lock digest, and refuses a taken `<ref>:<tag>`. Only then does it tag `<ref>:<tag>` on the **connected** host. It re-inspects the tag, then saves by that name, and records `savedAs`.
  - `load` and `verify` never tag. They check both `name` and `savedAs`.
  - Compose's `image:` lines keep their digests. That is why this is not the alternative (a) that A1.2 rejected, which removed the digest pin at start time.
- **Evidence:**
  - host run 2: digest-name save, `Loaded image ID:` with no name, verify exit 1, `No such image`;
  - host run 3 steps 04–09: `tagged …; saved as postgres:18`, `Loaded image: postgres:18`, verify exit 0, `up --pull never --wait` plus `/readyz` ready, no-egress stack healthy.
- **Correction recorded honestly.** A1.2 claimed that on the containerd store a digest reference resolves after load. Host run 2 contradicts that for a bundle saved under digest names. The amendment says so. Residual 8 is narrowed to "observed on one engine (29.9.2); classic store unobserved; no official documentation consulted".
- **DO-E4 Q2 (orchestrator's to decide):** my architectural recommendation is to keep the refusal, and never remove or move an operator's tag automatically.
- **Keycloak e2e:**
  - It runs on the **default** `test-idp` stack. The no-egress stack resets the published ports, so host run 3 step 11 got `ERR_CONNECTION_REFUSED`.
  - Its test process runs with `HTTP(S)_PROXY` and `ALL_PROXY` (both cases) unset, as in run 3c (4/4). Adding the IdP host to `NO_PROXY` is the equivalent alternative.
  - Cause: the IdP origin `https://keycloak:8443` is not in the host's `NO_PROXY`. Run 3b, with the proxy set, timed out. The proxy mechanism is stated as an inference, not as verified.
  - It changes no product code, Compose file or TLS rule.
  - New residual 10: a host whose proxy cannot be bypassed records that e2e BLOCKED.

### 2.2 ADR-0065: BE-F2 Q1 and Q2 (Amendment 1)

- **Q1: confirmed, both parts.**
  - **The contract change.** `bundleSchemaVersion` is neither required nor constrained in `ConfigBundle`. It is not a change to a gate-approved contract: the contract at DG6's approved commit `d8868b2a…` has 0 matches for `ConfigBundle|config_bundle`, so no gate is reopened.
  - **The absent-version rule.**
    - A **present** value other than `mth-config-bundle/1`, any type, is 422 first.
    - An **absent** value is 422 when the rest of the body is a v1 envelope, and the uniform 400 otherwise.
    - Nothing is stored in either case.
  - **Why not a route-inventory pin.** `REPORTED_DEVIATIONS` holds DG1–DG5 operations "pinned so the set only shrinks".
- **Q2: decided out of scope for DG7, with explicit refusal.**
  - Why: the owner of an imported rule, and the transformation of a scoped rule, have no stable key, and choosing the owner in the target is a product decision.
  - **Behaviour recorded as shipped:**
    - an export naming the kind is 422 `unportable_reference` (`/kinds/<i>`);
    - a default export carries 11 kinds, and `config_bundle_export.kinds` shows that `automation_rule` is absent;
    - an imported item is planned `refused` with `kind_unavailable`, and the import becomes `invalid` (commit 422 `not_committable`, nothing written).
  - The enum keeps 12 values, so the refusal stays specific.
  - `automation_rule_set` still travels.
  - The owner, transformation-scoped and starter-rule questions are listed as open, for a later ADR amendment.

### 2.3 ADR-0073 §6 and the history allow-list (DO-J2 Q1)

- **Acknowledgement list: yes, recorded in ADR-0073 Amendment 1.** It records:
  - the list's shape;
  - the loader's refusals: only L3/L4, only `gates/DG0–DG6.json`, a JSON path, 64 hex, a reason of at least 40 characters, no duplicates;
  - exact-sentence matching;
  - stale entries fail;
  - the list is read from the **payload** (a refused list fails V12, and a missing list acknowledges nothing);
  - the one DG3 entry.

  The L1–L5 rules are unchanged.
- **History allow-list entries: not in ADR-0073 §6.** V12 does not read the secret allow-list, and V13 uses the envelope scope, where history-only entries do not apply. They belong to ADR-0063 §1.3, which already permits history matching on `rule` + `valueSha256`. ADR-0063 Amendment 1 records:
  - the `scopes` key (with its default `["payload","history"]`);
  - the S2 own-mask exclusion `/^\[S\d(?:-documented)?:/`;
  - the two history-only entries with their accepted breadth, as residuals 7 and 8.

## 3. Checks run (real exit codes)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, no network, no Docker daemon. Logs are in `docs/delivery/handbacks/DG7/T-DG7-ARCH-R7-evidence/`.

| Command | Exit | Result | Log |
| --- | --- | --- | --- |
| `npx prettier --check` on the four ADRs | 0 | all formatted | `prettier-adrs.log` |
| `node tools/gates/validate.mjs --historical --stage DG6` | 0 | `PASS gate DG6 (historical)` | `validate-historical-DG6.log` |
| `pnpm openapi:lint` | 0 | `OpenAPI 3.1.1, 965 operations` | `openapi-lint.log` |
| `pnpm lint` | 0 | — | `lint.log` |
| `pnpm -r typecheck` | 0 | — | `typecheck.log` |
| `node tools/release/claims-scan.mjs` | 0 | `PASS (887 files; …)`. The new ADR texts make no claim. | `claims-scan.log` |
| `node tools/release/secret-scan.mjs --scope payload` | 0 | `PASS (payload; 3142 files; allowed 33; …)` | `secret-scan-payload.log` |
| `node tools/release/secret-scan.mjs --path <each of the four ADRs>` | 1 | one S2 hit, at ADR-0063 **l.40**, a line I did not change | `secret-scan-path.log` |
| The same path scan on the **HEAD** copy of ADR-0063 (scratch copy under `$TMPDIR`, deleted) | 1 | the same hit, so it predates this task. The payload scan, which is the release scope, passes. | `secret-scan-path-ADR-0063-at-HEAD.log` |
| `pnpm test` | 0 | unit-node 205 files / 3022 tests; unit-web 130 / 2175; nocodegen 3 / 259 (+2 skipped) | `pnpm-test.log` |
| `QA_PG_PORT=27731 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | 0 | 111/111, 113.6 s | `contract-integration.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` (this handback included) | 0 | all formatted | `prettier.log` |

- The `grep 'FAIL\|✗\|×'` over `pnpm-test.log` matched only two passing test titles (l.62 and l.1280).
- No integration test was touched, so none other than the contract test was rerun.
- Ended 2026-11-14T18:47:43Z (`date -u` after the last check), about 23 minutes.
- **Protocol note:** the DG6 `--historical` validator ran after the ADR edits, not before them. This is a documentation-only task, and the run passed.

## 4. Known gaps

1. **Not verified against official documentation.** The agent sandbox has no network, so these points are inferences from the host-run evidence and are labelled as such in the ADRs: the Docker store behaviour (A2.1 item 4, residual 8) and the Chromium proxy mechanism (A2.2 item 2). M0314 evidence for the store behaviour stays **pending**.
2. **Follow-ups the ADRs name. None of these files is mine:**
   - the run instructions in the header of `e2e/support/keycloak-login.ts` should state "proxy variables unset, or the IdP host in `NO_PROXY`" (ADR-0069 A2.2 item 3);
   - the `known-limitations.md` row and its Arabic summary for `automation_rule` go to DOC-B (ADR-0065 A1.2 item 6, with BE-F2's proposed text);
   - hiding the export checkbox goes to FE-B;
   - the AN-P7 register note that REQ-S19-008 covers the twelve kinds less `automation_rule` (ADR-0065 A1.2 item 4).
3. **Pre-existing secret-scan path hit.** `secret-scan --path` on ADR-0063 reports S2 at l.40, which is unchanged since `HEAD`. The payload scan passes. I did not reword it, because the line is outside this task's questions. It goes to the orchestrator (Q4).
4. **ADR-0069's version-evidence section** still cites Docker 29.3.1 / Compose v5.1.1 from P1. Amendment 2 records that the host runs used 29.9.2 / v5.6.1, but the original section was not rewritten.
5. I did not reread `docs/architecture/p7-plan.md` in full (header).

## 5. Open questions and merge instructions

- **Q1 (orchestrator; DO-E4 Q2).** Keep `save`'s refusal of a stale `<ref>:<tag>` (my recommendation, ADR-0069 A2.1 item 5), or decide otherwise.
- **Q2 (orchestrator, routing).** Route the follow-ups of §4 item 2.
- **Q3 (code-security reviewer).** Please judge ADR-0063 Amendment 1, residuals 7 and 8 (value-wide history entries; the own-mask exclusion), and ADR-0073 A1.1 together with the list itself (DO-J2 Q2).
- **Q4 (orchestrator).** ADR-0063 l.40 quotes a redaction fixture's credential URL, which a `--path` scan flags. Reword it, or leave it, since the payload scope is clean?
- **Q5 (orchestrator).** D-267's "Open for the architect" items are answered by these four amendments. A decision entry that adopts them is the orchestrator's.
- **Merge.** Four ADR files, the handback and its evidence. There are no migrations, contract, generated or `p7-pending` changes. A conflict is possible only if another task edits the same ADRs.
- These amendments are engineering design records. They approve nothing. Product gate G6 does not imply DG7, and DG7 does not imply any product gate G1–G6. No business, Finance or IT approval is granted or implied.
