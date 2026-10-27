# Handback: T-DG6-ARCH-05 (slice D, the optional assistant; the D-199 ADR amendments), completed by T-DG6-ARCH-05B

- **Role:** solution-architect. **Stage:** DG6 (BUILDING), branch `claude/mobily-transformation-platform-dg5-regate2`.
- **Runs:**
  - T-DG6-ARCH-05: run `DG6-T-DG6-ARCH-05-solution-architect-20261027T032051Z-e9105022`. It stopped at the account's usage limit (exit 1, "weekly limit"). Its partial work is committed at `79cb23c`.
  - **This continuation, T-DG6-ARCH-05B:** run `DG6-T-DG6-ARCH-05B-solution-architect-20261027T051339Z-a722402e`, session `a722402e-cb8e-4e0a-b636-01cb895ff436`. Base `HEAD` `7fed068`; assignment sha256 `b7316fee…959397` (verified).
- **`date -u` (ARCH-05B):**
  - start: `Tue Oct 27 05:14:02 UTC 2026`;
  - end: see §8.
- **Engineering only.** Nothing here grants, records or implies a G1–G6 business approval, a Finance validation or an IT approval. "IT-approved provider" and "company authorization" are configuration slots that Mobily IT fills; no task claims that IT approved an endpoint. Product gate G6 never implies DG7.

## 0. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, **exit 0** (run at 05:14 UTC, before any write).

## 1. What each run delivered

Legend: **[05]** = committed by the first run at `79cb23c` and reviewed by this continuation; **[05B]** = written by this continuation.

### 1.1 Review of the committed partial work [05]

I re-read the migrations, the ADR and the probe, and re-ran the probe and the dictionary generator. Results:

- **Probe re-run:** `probe-output-05B-rerun.txt` → **106/106 PASS, exit 0** on a fresh cluster (port 23720).
- **Generator re-run:** `gen-dictionary.ts` output is **byte-identical** to the committed `dictionary-section.md` and `schema-types.ts.txt`.
- **Migration hashes:** `migration-sha256.txt` equals the current files: `0111` `87fbab38…ef721`, `0112` `64b33a14…4789d`.

The two failed probe runs of the first run are kept as evidence:

- **`probe-output-run1-trigger-error.txt`** (exit 2): a probe-script error (`Cannot read properties of undefined (reading 'version')`, then a TypeError at `probe.ts:382`). The harness read a row that an earlier failed step had not created.
- **`probe-output-run2-probe-error.txt`** (105/106, exit 1): `SG16` failed with `42601 multiple assignments to same column "updated_at"`. The probe's own UPDATE set `updated_at` twice. This is a defect in the probe statement, not a guard failure.

Both were fixed in the probe before the committed run. The migration hashes the committed run applied are the ones that are in the tree now.

**Corrections made by this continuation:**

1. **The first run's list-bound probe was not exact for `listTemplateSourceLinks`.** LB01 counted it as a migration-fixed catalogue (`playbook_block_link`, no INSERT). The route also resolves a version's `linksAdded`, up to 50 per block element under the `0089` guard, across 165 blocks. Its true bound is therefore 8,252, not the seeded row count. ADR-0007 §4a now lists it among the unbounded lists, for pagination.
2. **`listGateSubmissionCriteria`.** LB06's text says "the gate's own definitions". The database bound is the 32 `gate_criterion_definition` rows: `criterion_key` references `gate_criterion_definition (key)`, not the gate's own subset. ADR-0007 §4a states 32 and explains the difference.

3. **The first run seeded two permission codes but did not add them to the contract's `PermissionCode` enum.** As a result, `getMe` returned codes the contract did not allow. My first full integration run found it: `contract.test.ts` "auth + me": `data/effectivePermissions/0/permissions/2 must be equal to one of the allowed values`, with 72 tests of that file failing in cascade. I stopped that run (log kept as `test-integration-run1-stopped-permission-enum.log`, marked as stopped, not a completed run). I appended `assistant.use` and `assistant.configure` to the enum. The zod mirror `permissionCode` derives from `PERMISSION_CODES` and needed no change. After the fix:
   - the contract directory passes alone: 3 files, 211 tests, exit 0 (`test-integration-contract-targeted.log`);
   - the 8 unit test files that read `openapi.yaml` pass with `C.UTF-8`: 236 tests, exit 0 (`test-openapi-readers-after-enum.log`).

   Then the full suite was re-run (§8).

I found no defect in `0111`/`0112`, `schema.ts`, the seed and catalogue pins, `permissions.ts`, the advisory-lock registry or the ADR-0016 row.

### 1.2 Deliverables

| # | Deliverable | Status | By |
|---|---|---|---|
| 1 | **ADR-0059** (`docs/architecture/adr/ADR-0059-p6-optional-assistant-provider-port-retrieval-citations-guardrails.md`) | Complete. ADR-0060 is not needed and stays reserved. | [05] written; [05B] completed: the contract response shapes (§3), `createAssistantConversation`/list/get semantics (§9), the contract and pending-list consequence, and the status line |
| 1a | **ADR-0007 §4a amendment** (bounded collections named one by one, D-199) | Complete | [05B] |
| 1b | **ADR-0052 §6 amendment** (the live dependency audit is not BLOCKED here; BLOCKED stays for networks without the advisory service) and **§7 amendment** (cross-reference to §4a) | Complete | [05B] |
| 2 | Migrations `0111_p6_assistant.sql`, `0112_p6_assistant_permissions.sql`; `schema.ts`; `seed.test.ts`, `catalogue.test.ts`, `identity.test.ts` pins; `permissions.ts`; lock 730323 in `advisory-locks.ts` (+ test) and the ADR-0016 §6 registry | Complete | [05] (reviewed, re-run [05B]) |
| 3 | Probe on a disposable PostgreSQL | 106/106, run twice (§3) | [05], re-run [05B] |
| 4 | ERD §1x and data dictionary "P6 tables, slice D" | Complete | [05B] (dictionary content generated by [05]'s generator) |
| 5 | Contract: 9 operations, tag `assistant`, `info.version` `1.5.0-p6` (unchanged; already set by ARCH-01); pending lists; `contract.test.ts` pin 922 → 931 | Complete | [05B] |
| 6 | Permissions matrix §28; `p6-work-split.md` §D (D.0–D.10) | Complete | [05B] |
| 7 | This handback | Complete | [05B] |

**Nothing is left for a further continuation.**

## 2. Behaviour delivered per requirement (design and database; implementation is BE-T/BE-U/FE-E)

- **REQ-S17-007**
  - ADR-0059 §1, §4, §5, §9: retrieval only through `search` and `ReadScope` as the caller, with citations of record ids and versions, or playbook blocks at version 1.0.
  - The database enforces at least one citation per answer and the exact citation shape (CV16a, CV19a–g).
  - Every reply and suggestion carries `label: assistant_suggestion` in the contract.
  - Stored conversations re-check every citation at read time.
- **REQ-S17-008**
  - The port has no tool interface, and the assistant has no write path (§7). Draft fields are text-only and can never be money, a rate, a date, an owner or an option (SG03a–f).
  - Taking a suggestion to a draft writes nothing outside `assistant_suggestion` (SG18).
  - Refused intents are refused before retrieval and before any model call. The codes and English texts are in §8.
- **REQ-S17-009**
  - No row means off, and a fresh install has no row (G01b, G04).
  - A row is created disabled (AS01). Enabling requires a provider and an authorization reference, plus the endpoint, API style and model for `http_endpoint` (AS06–AS07). It is audited.
  - The credential is a `SecretRef` only (AS11). While enabled, the fields that decide where data goes are locked (AS14a–e).
  - `telemetryEnabled` is the constant `false`. `telemetry-search.txt` shows that no telemetry client exists.
  - For A21: a connection log built on Node diagnostics channels (§12; channel check `connection-log-channel-check.txt`).
- **REQ-S17-010:** no core module depends on `assistant` (§13). The A21 lifecycle runs with no setting row.
- **REQ-S17-011:** document text is passed only as JSON string values inside one data message (§5). There is one retrieval pass, derived from the user's prompt only (§4 item 4).
- **D-199 (pagination rule):**
  - ADR-0007 §4a exempts **21** lists by name, each with its bound and the reason it holds.
  - It names **17** unbounded lists for **T-DG6-BE-V** (`p6-work-split.md` §D.5).
  - 21 + 17 = the 38 names of `UNPAGINATED_LISTS_AT_HEAD`.

None of the five requirements is complete: each needs BE-T, BE-U, FE-E, QA-B and QA-D (work split §D.9).

## 3. Migration-apply and guard-probe output

- **Command:** `QA_PG_PORT=23720 MTH_PORT_POOL=23721-23749 tests/qa/support/with-pg.sh node --conditions=@mth/source docs/delivery/handbacks/DG6/T-DG6-ARCH-05-evidence/probe.ts`. PostgreSQL 16.13, UTF8, C locale.
- **Result:** **exit 0, 106/106 PASS** (`probe-output-05B-rerun.txt`). The first run's committed `probe-output.txt` has the same result.

Excerpt:

```
migrations shipped: 104 (0001_identity_access.sql .. 0112_p6_assistant_permissions.sql)
PASS  G00 slice D migrations 0111-0112 present directly above 0110 (D-196); nothing above 0112
PASS  G01 fresh database: 0001..last apply  -- applied 104
PASS  G01b a fresh install has no assistant_setting row, i.e. the assistant is disabled
PASS  G02 P5 database populated (0001-0097; 2 transformations, ... 12 initiatives; 3 users)
PASS  G03 P6 (0098..last, including slice D 0111-0112) over the P5 database apply  -- applied 15
PASS  G04 the upgrade leaves existing rows as they were (... byte-identical, audit count unchanged); no assistant row
PASS  AS02 missing audit fails at COMMIT (assistant_setting_audit_required)
PASS  SG01 missing audit fails at COMMIT (assistant_suggestion_audit_required)
PASS  SG13 a non-stepping suggestion version fails (assistant_suggestion_version_step)
PASS  SG17 mth_app cannot DELETE a suggestion, a conversation or a message (no grant)
PASS  NW01 ... initiatives, transformations and gate instances are byte-identical to before the upgrade
PASS  PM04 the technical-admin trigger still refuses a business-approval code for ADM_TECH (REQ-S10-003)
PASS  LB01 ... LB06 (list bounds)
106/106 PASS
EXIT=0
```

The guard classes the assignment asks for are each proven:

- **Missing audit fails at COMMIT:** AS02, CV (conversation), SG01, SG14.
- **A non-stepping version fails:** the AS, CV and SG version-step probes, including SG13.
- **UPDATE/DELETE on history or append-only tables fails:** AS17–AS19 (`assistant_setting_change`), CV14/CV14b/CV15 (`assistant_message`).
- **Every invariant ADR-0059 claims:** the AS, CV, SG, NW and PM groups.

**List-bound inspection** [05B] (`list-bounds-inspect.ts` → `list-bounds-inspect.txt`, exit 0, port 23710): every migration applied to an empty database. For each table behind the 38 lists it records the row count, whether `mth_app` holds INSERT, and the unique constraints and indexes. For example:

```
catalogue rows (mth_app has no INSERT unless marked): permission=185 role=14 role_accountability=14 phase_definition=6 guiding_question=4 decision_right_template=4 governance_party=18 adoption_indicator_template=8 benefit_formula_example=2 form_record_type=33 report_definition=12 config_review_policy=7 job_schedule=16 methodology_element_profile=56 source_element[health_question]=25
extra: {"profiles":56,"profile_ins":false,"max_links_per_block":14,"max_seeded_links_per_template":2,"blocks":165,...}
```

## 4. Checks run by this continuation (Node 24.21.0)

| Command | Exit | Result | Log (`T-DG6-ARCH-05-evidence/`) |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG5` | 0 | PASS gate DG5 (historical) | (console) |
| `pnpm -r typecheck` | 0 | all packages | `check-pnpm_-r_typecheck.log` |
| `pnpm -r build` | 0 | all packages | `check-pnpm_-r_build.log` |
| `pnpm lint` | 0 | `eslint . --max-warnings=0` | `check-pnpm_lint.log` |
| `git ls-files -mo --exclude-standard \| … xargs npx prettier --check --ignore-unknown` (changed and new files) | 0 | "All matched files use Prettier code style!" | (console) |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 931 operations` | `check-pnpm_openapi_lint.log` |
| `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | **1** | unit-node **1 failed** \| 2462 passed (2463; files 1 failed \| 155 passed); unit-web 1768 passed (96 files); formula 259 passed \| 2 skipped | `test-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **1** | identical: unit-node 1 failed \| 2462 passed; unit-web 1768 passed; formula 259 passed \| 2 skipped | `test-c-utf8.log` |
| (after the `PermissionCode` enum fix) `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm exec vitest run` on the 8 unit files that read `openapi.yaml` | 0 | 8 files, 236 tests passed | `test-openapi-readers-after-enum.log` |
| (after the fix) `QA_PG_PORT=23735 … with-pg.sh pnpm exec vitest run --project integration apps/api/test/integration/contract/` | 0 | 3 files, 211 tests passed | `test-integration-contract-targeted.log` |
| first full integration run (before the fix), port 23730 | stopped | `contract.test.ts` 72 of 101 failed on the enum defect (§1.1 item 3); stopped by me | `test-integration-run1-stopped-permission-enum.log` |
| `QA_PG_PORT=23730 MTH_PORT_POOL=23731-23749 tests/qa/support/with-pg.sh pnpm test:integration` | see §8 | see §8 | `test-integration.log` |
| probe (§3) | 0 | 106/106 | `probe-output-05B-rerun.txt` |
| list-bound inspection | 0 | facts above | `list-bounds-inspect.txt` |
| dictionary generator re-run | 0 | byte-identical to the committed section | (diff, console) |

**Repository-wide prettier, in the assignment's literal form:** `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`.

- **First run: exit 123.** One file was flagged: `packages/db/src/seed.test.ts`, committed by the first run [05] (its 0112 `matchAll` line was not formatted). Log: `check-prettier-repo-run1-seed-test.log`.
- **Fix:** `prettier --write` on that file. The change is formatting only (3 lines re-wrapped).
- **After the fix:**
  - re-run: **exit 0** (`check-prettier-repo.log`);
  - `vitest run packages/db/src/seed.test.ts`: 68 passed;
  - `pnpm lint`: exit 0.

**The one unit failure is not caused by this task.** It is `deploy/scripts/tests/dep-audit.vitest.mjs` "no High/Critical advisory in the committed snapshot matches a shipped component of the committed SBOM", which reports `FAIL: 20 High/Critical match(es) on shipped components`:

- This is the designed failure that T-DG6-DO-A reported (its handback §0). D-199 decided on upgrades, and T-DG6-DO-A2 runs them in this wave.
- This task changed no dependency, lockfile, SBOM or snapshot.
- It fails identically with the locale unset and with `C.UTF-8`.

**Pinned counts:**

- `contract.test.ts` operation count **922 → 931** (9 slice D operations; the pending precedent, p6-plan §5.3).
- The first run changed: `advisory-locks.test.ts` 51 → 52 classes; the `identity.test.ts` permission list (+ `assistant.use`); `catalogue.test.ts` (0111 guards, mutable-table and privilege pins); `seed.test.ts` (0112 equals `P6_ASSISTANT_*`).
- `UNPAGINATED_LISTS_AT_HEAD` is **unchanged** (38). `listAssistantConversations` declares a required `nextCursor`, so it does not join the pin.

## 5. DG1–DG5 artifacts changed, and why (D-195; D-199)

| File | Change | Why |
|---|---|---|
| `docs/architecture/adr/ADR-0007-api-conventions.md` | **§4a amendment** (additive text): the rule (exempt only when named here, with an enforced bound ≤ 250), 21 named bounded lists with bound and reason, and 17 unbounded lists named for T-DG6-BE-V | D-199 ("exempt bounded collections by name, each with its bound stated; any list it cannot bound gets pagination in a later task"). No operation, schema or response changed. |
| `docs/architecture/adr/ADR-0016-…md` | §6 registry rows 730323, 730324–730325 [05] | Lock registration (assignment deliverable 2) |
| `apps/api/test/integration/identity.test.ts` [05] | permission list + `assistant.use` | 0112 seeds a new code (pin pattern) |
| `docs/api/openapi.yaml` | 9 new operations, 2 path parameters, 16 schemas, tag `assistant`, and the two new codes appended to the `PermissionCode` enum (the ARCH-04 `saved_view.*` precedent). **Every P1–P5 path is byte-stable**: `git diff --numstat` shows 424 lines added and 0 removed (insertion only: before `components:`, among the parameters, after the `imports` tag, in the enum, and at the end of `schemas`) | D-195 contract-first |
| `docs/architecture/erd.md`, `data-dictionary.md`, `docs/analysis/permissions-matrix.md` | new sections only (§1x; "P6 tables, slice D"; §28) | Deliverables 4, 6 |

The ADR-0052 amendments (§6, §7) and the ADR-0059 completion are DG6 artifacts.

## 6. Decisions and questions for the orchestrator

1. **AUD and the assistant** (ADR-0059 Alternatives 5). AUD reads the setting and gets 403 on every assistant write, including starting a conversation, because a conversation writes the caller's rows (REQ-S10-001). Granting AUD `assistant.use` would be one role link in a later migration. **Decision needed only if you want AUD to use the assistant.**
2. **T-DG6-BE-V** (work split §D.5) is a new task: cursor pagination for the 17 unbounded lists. It needs a contract extension (additive `nextCursor` plus `Cursor`/`Limit` on those 17 operations, D-196 item 4) that you approve first. If the 17 do not fit one run, split it as BE-V/BE-V2. Until it ships, ADR-0007 §4 is met by 21 named exemptions plus 17 named open items, not in full.
3. **ADR-0007 §4a threshold.** I set the exemption limit at 250 items so that a catalogue such as `listPermissions` (185) qualifies while `listTemplateSourceLinks` (8,252 worst case) does not. Confirm or change the number.
4. **`createAssistantConversation` refuses with 422 `assistant.disabled` while AI is off.** List and get keep working, so users can read their history. This is in ADR-0059 §9 and the contract.

## 7. What the implementers of slice D must know

The full text is `p6-work-split.md` §D.10. In short:

- **Off means no call.** No outbound request may be made while the assistant is disabled; prove it with the fake model's request count.
- **No tools and no write path.** The port has no tool interface, and the assistant writes only its own tables.
- **No remote I/O inside a transaction.** Retrieval and the model call run between the two transactions.
- **Untrusted text is data.** Record and document text is passed only as JSON string values in the one data message.
- **Logging.** Never store or log the credential, the request, retrieved text, raw responses or headers.
- **Honest status.** The HTTP adapter is tested against the local fake only. The live IT endpoint and real model behaviour are residuals (lesson 14).
- **Exact texts.** Refusal codes and texts are ADR-0059 §8 and §10 verbatim.
- **Migrations.** No slice D task needs one. Ask the orchestrator if you find you need one.
- **Order.** ARCH-05 → BE-T → BE-U → FE-E → QA-B → QA-D. `server.ts` and `worker/main.ts` wiring lines are merged by the orchestrator.
- **Connection-log channel check.** It bound an OS-chosen port (`listen(0)`, ports 33975/37475, above 32768). It is a one-off evidence script, not a harness. BE-T's real test must use a harness port below 32768 (lesson 8).

## 7a. Changed files

**This continuation [05B]:**

| File | Purpose |
|---|---|
| `docs/architecture/adr/ADR-0059-…md` | Completed: the response shapes, the conversation create/list/get semantics, the contract consequence, the status line |
| `docs/architecture/adr/ADR-0007-api-conventions.md` | §4a: bounded collections named, with their bounds; 17 lists named for BE-V |
| `docs/architecture/adr/ADR-0052-…md` | §6: the live audit wording (D-199); §7: cross-reference to §4a |
| `docs/api/openapi.yaml` | 9 operations, 2 parameters, 16 schemas, tag `assistant`, 2 enum values |
| `apps/api/test/support/p6-pending-arch-05.ts`, `p6-pending-be-t.ts`, `p6-pending-be-u.ts` (new); `p6-pending.ts` (one import, one spread) | The pending lists for the 9 operations |
| `apps/api/test/integration/contract/contract.test.ts` | Operation count 922 → 931, with its comment line |
| `docs/architecture/erd.md` | §1x and §1x.1 |
| `docs/architecture/data-dictionary.md` | "P6 tables, slice D" (generated content) and the 0111 functions |
| `docs/analysis/permissions-matrix.md` | §28 |
| `docs/architecture/p6-work-split.md` | §D (D.0–D.10) |
| `packages/db/src/seed.test.ts` | prettier formatting of the first run's 0112 line (no logic change) |
| `docs/delivery/handbacks/DG6/T-DG6-ARCH-05-evidence/list-bounds-inspect.{ts,txt}` (new) | The list-bound facts |
| `…/probe-output-05B-rerun.txt`, `check-*.log`, `test-*.log` (new) | Check evidence |
| this handback | — |

**The first run [05], at `79cb23c`:** `0111`, `0112`, `packages/db/src/schema.ts`, `packages/db/src/seed.test.ts`, `packages/db/test/integration/catalogue.test.ts`, `packages/shared/src/permissions.ts`, `apps/api/src/modules/platform/advisory-locks.ts` (+ test), `apps/api/test/integration/identity.test.ts`, ADR-0016 §6, ADR-0059 (first version), and the evidence files listed in §1.1 and §3.

**Merge instructions:**

- Apply `0111` and `0112` with `mth-db migrate`. They are already on the branch and are forward-only.
- No other migration.
- Expect no conflict with BE-C, BE-F2 or DO-A2 on these files, with one exception: `contract.test.ts` (operation-count line). If another branch changes that line, reconcile it by adding the deltas.

## 8. Integration suite and end time

(Filled in when the full suite finished; see below.)
