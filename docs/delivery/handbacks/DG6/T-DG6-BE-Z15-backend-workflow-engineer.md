# T-DG6-BE-Z15 handback: issuer-bound restricted tokens (F-DG6-640, D-233)

- **Role:** backend-workflow-engineer.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG6-T-DG6-BE-Z15-backend-workflow-engineer-20261109T143120Z-f5b7f170","session_id":"f5b7f170-078e-4089-a551-fe2b67e5f76e"}`.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-BE-Z15.md`. Its sha256 `3b8f3ee7…a7a9` was verified at start.
- **Stage:** DG6 (P6), FIXING.
- **Base:** branch `dg6/be-z15`, `HEAD` `19ac619b6`. The working tree was clean at start.
- **Time:** started `2026-11-09T14:31:32Z`; ended `2026-11-09T15:21Z`, about 50 minutes, inside the limit.
- **Changes:** left **uncommitted** for the orchestrator.

This is an engineering repair. It grants no business, Finance or IT approval. Product gates G1–G6 are untouched, and nothing here implies any DG0–DG7 result. All test data is synthetic. The "publish" in the tests is a synthetic configuration review through the 0074 guard, not a business approval.

## 0. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG5` → `PASS gate DG5 (historical)`, **exit 0**. It was run first, at 14:31Z, before any change.

## 1. What changed and why

F-DG6-640: a D-231 token `[restricted:<version>:<k>]` named only a row-version number. Every version row of every rule shares those small counters. So a token copied from the published version into its draft, or from another rule, at the same row-version number was resolved against the wrong row. The hidden literal was silently replaced by another hidden literal.

The fix (D-233):

- **Token form.** The token is now `[restricted:<tag>:<k>]`. `<tag>` is an **opaque issuer tag**: the first 96 bits (24 lowercase hex digits) of HMAC-SHA256(`key`, `"mth.automation.restricted-token.v1"` LF `<row id>` LF `<row version>`).
- **Key source (the construction D-233 asks me to justify).** The key is the issuing row's own secret, `automation_rule_version.restricted_token_key`, added by **migration 0127**. Why not a configured key:
  - The existing configuration has no general server-side key. `AppConfig` has the optional OIDC client secret, absent in local auth mode, and the database URLs, which are credentials. Reusing either would be key reuse.
  - A per-process random key breaks across replicas and restarts.
  - A new deployment secret is a configuration and operations change (D-195), and a development default would put a secret in the repository.
- **The per-row key:**
  - 32 random bytes from PostgreSQL's strong source, `uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid())`: 244 random bits, core PostgreSQL, no extension. `ADD COLUMN` gave every existing row its own key.
  - Constrained to 32 bytes and immutable (trigger).
  - Never served, audited, logged or copied into a new version.
- **Disclosure.** HMAC is a pseudo-random function, so the tag discloses neither the row id nor any literal, and it cannot be computed offline.
- **Collisions.** 96 bits give about 6 × 10⁻¹⁸ for a million issued (row, revision) pairs.
- **Save.**
  - A token is resolved only when its tag equals the tag of the row being replaced at the If-Match version. The comparison is constant-time.
  - Any other well-formed tag is refused **422 `automation_rule.restricted_token_stale`**: another version row, another rule or another row version.
  - So is a token in the retired D-231 form, which makes every pre-deploy token stale, and the editor asks the author to reload.
  - The right tag with an unknown position, the bare marker, an upper-case tag or other marker-like text stays **422 `restricted_marker_unknown`**.

## 2. Files changed

| File | Purpose |
|---|---|
| `packages/db/migrations/0127_p6_automation_restricted_token_key.sql` | **New migration 0127** (the next id above 0126 on this branch; renumber at merge if needed, D-196). Adds the per-row key column, its 32-byte CHECK, and the immutability trigger. |
| `packages/db/src/schema.ts` | `AutomationRuleVersionTable.restricted_token_key: Generated<Buffer>`, and `SCHEMA_COLUMNS`. |
| `packages/shared/src/schemas/automation.ts` | Token contract: `automationRestrictedToken(tag, k)`, `AUTOMATION_RESTRICTED_TOKEN_TAG_HEX_LENGTH`, the new `AUTOMATION_RESTRICTED_TOKEN_PATTERN`, and `AUTOMATION_RESTRICTED_TOKEN_RETIRED_PATTERN`. |
| `apps/api/src/modules/automation/versions.ts` | `RestrictedTokenIssuer` and `restrictedTokenTag` (HMAC). `redactConditionLiterals` takes the issuing row. `resolveRestrictedTokens` checks the tag. The stale refusal text is corrected. |
| `apps/api/src/modules/automation/rules.ts` | The rule list and rule read pass the effective version row as issuer. |
| `apps/web/src/i18n/{en,ar}/problems.json` | `automation_rule__restricted_token_stale` text made true for the new cases (see §6). |
| `apps/web/src/pages/automation/ContentEditor.tsx`, `RulePage.tsx` | Comments only: the token is opaque, and the web never computes or parses a tag. Logic unchanged. |
| `apps/api/test/integration/access/automation-restricted-tokens-z15.test.ts` | **New** API tests (a) to (g), real API, disposable PostgreSQL. |
| `apps/api/test/support/restricted-tokens.ts` | **New** test helper: the expected token of a row and version, via the API's own `restrictedTokenTag`. |
| `apps/api/test/integration/access/automation-restricted-tokens-z13.test.ts`, `…-z14.test.ts`, `sensitive-reference-pending-z12b.test.ts` | The expected token text moves to the issuer-bound form. Behaviour assertions are unchanged. |
| `apps/web/src/pages/automation/rule-editor-tokens-z14.test.tsx` | Opaque fixture tags, plus the new Z15 editor case (en and ar). |
| `apps/web/src/pages/automation/fed.test.tsx` | Fixture tokens in the new form (the label follows the token). |
| `packages/db/test/integration/catalogue.test.ts` | The 0127 test (trigger, one distinct 32-byte key per row, update refused, CHECK and default text), and the 0074 trigger list excludes the 0127 trigger. |
| `apps/api/test/support/sensitive-reference-inventory.ts` | The `fix` text of the conditions row (the format). |
| `docs/architecture/adr/ADR-0051-…md` | Part A of the D-231 amendment rewritten in place, with a correction note quoting the superseded text. Pointers added at the §2 table row, the re-save bullet, the 2026-11-09 Read bullet and its shared-constants bullet. The "No migration" line is corrected. |
| `docs/architecture/adr/ADR-0043-…md` | One "Issuer binding" sentence after the D-231 version-binding bullet. That bullet stated the token format, which is now untrue, and ADR-0051 holds the rule. Outside the three records the brief names; disclosed here. |
| `docs/api/openapi.yaml` | The condition-value description, the `includesRestrictedRecords` description and the `updateAutomationRuleVersion` summary (`restricted_token_stale`). |
| `docs/architecture/data-dictionary.md` | The `automation_rule_version` column, trigger and read-time line; the read-time classification row; and a new "P6 round-10 repair migration 0127" section. |
| `docs/delivery/handbacks/DG6/T-DG6-BE-Z15-evidence/*` | Logs and the adapted domain probe, with its diff. |

**API endpoints added:** none. Behaviour changed on existing operations:

- `getAutomationRuleVersion`, `listAutomationRuleVersions`, `getAutomationRule` and `listAutomationRules` show the token format.
- `updateAutomationRuleVersion` gets the tag check.
- `createAutomationRule` is unchanged: any token is unknown there.

**Contract shape:** unchanged (the value is still a string). Only the description and the token text change.

## 3. Behaviour delivered, per requirement row

**REQ-S10-002.** Acceptance (quoted): *"A12: a Business Owner on transformation X gets 403/404 reading transformation Y; a sensitive benefit is hidden from a workstream member without the grant"*.

This repair keeps the hidden literal bound to the record it was shown for. A reader without the grant still never sees the sensitive benefit's id (`leaks()` is asserted empty in every z15 case). A token can no longer silently stand for a different hidden record. The cross-scope part (403/404) is untouched.

The brief's items, each on the real API (`automation-restricted-tokens-z15.test.ts`):

| Brief item | Case | Before fix (log 01) | After fix (logs 04, 07) |
|---|---|---|---|
| Opaque tag; no row id, no row version, no hidden value; other rows give other tags | (a) | **FAIL** (the tag was `1`) | PASS |
| Token copied from the published v1 into draft v2 at the same row version | (b) | **FAIL** (200, v2 stored `[P, H, H]`) | PASS: 422 stale, pointer `/content/conditions/2/value`, draft and published unchanged |
| Token copied from another rule at the same row version | (c) | **FAIL** (200) | PASS: 422 stale, B unchanged; B's own token still saves |
| F-DG6-580: same draft re-saved | (d) | pass (regression guard: 580 was fixed by Z14) | PASS |
| F-DG6-580: re-save after a 409 | (e) | pass (regression guard) | PASS |
| Normal round trip keeps the hidden literal (token moved into an `in` list; fresh tag re-issued; re-save) | (f) | pass (regression guard) | PASS |
| Retired D-231 form refused stale, even at the current version | (g) | **FAIL** (it resolved) | PASS |

**Disclosure on "every new test needs a before-fix log that fails".** (d), (e) and (f) are the brief's F-DG6-580 and round-trip cases. That defect was already fixed by T-DG6-BE-Z14, so they pass before this fix too. They are regression guards, and log 01 shows them passing honestly. The cases that are new behaviour, (a), (b), (c) and (g), fail before and pass after.

**The domain reviewer's probe** (`test-evidence/DG6/domain/round-10/probes/dom-r10-token-binding.test.ts.txt`), copied in temporarily as `apps/api/test/integration/zz-domain/…` and removed afterwards:

- **Before fix (log 01):** (i) cross-rule and (j) published→draft FAIL. B stored `[<Q>, <H2>, <H2>]`; v2 stored `[<P>, <H>, <H>]`.
- **After fix, unmodified probe (log 03):** (i) and (j) PASS (422 stale, nothing stored). (g) and (e) FAIL only because they assert the retired literal text `[restricted:<version>:<k>]`.
- **After fix, adapted probe (logs 04, 07):** all 6 PASS. Only the token literals move to the new form, with behaviour assertions unchanged. See `dom-r10-token-binding.adapted-z15.test.ts.txt` and `.diff`.
- **Adapted probe caveat.** Its added upper-case case would resolve, rather than refuse, if a tag happened to be all decimal digits. That probability is (10/16)²⁴ ≈ 1.3 × 10⁻⁵ per run. The case is in the evidence copy only, not in the tree.
- **z15 (a) caveat.** "No 8-hex run of an id inside the tag" has a random false-failure chance of about 3 × 10⁻⁷.

**Web (brief item 2)**, `rule-editor-tokens-z14.test.tsx`, Z15 cases, en and ar:

- The issuer-bound token shows the restricted label on its own row only.
- A token pasted from another version is sent verbatim with the served If-Match.
- The new 422 shows the "changed, re-apply" alert (`workflowsP5.rules.changedReapply`). The form reloads, and the pasted token is never re-sent.
- **Before fix (log 02, shared pattern at HEAD):** the 2 Z15 cases FAIL, and so do the 3 fed.test cases whose fixtures carry the new form (the label is not recognized). 32 pass.
- **After fix:** 37/37 PASS (in `pnpm test`).
- The editor logic is unchanged. `isChangedSinceRead` already covered the code.

## 4. Checks run (real exit codes)

Ports used: 31400–31414 only. Before each test run, empty `.claude/.cc-writes` directories were removed (none were found).

| # | Command | Result | Log |
|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG5` | exit 0, PASS | (console, §0) |
| 01 | `with-pg.sh npx vitest run --project integration <z15> <domain probe>`, **before fix** | exit 1: 6 failed, 7 passed (13). Expected (§3). | `01-before-fix-z15-and-domain-probe.log` |
| 02 | `npx vitest run --project unit-web rule-editor-tokens-z14 fed`, **before fix** (shared at HEAD) | exit 1: 5 failed, 32 passed (37). Expected. | `02-before-fix-web.log` |
| 03 | `with-pg.sh … z15 z14 z13 z12b <domain probe unmodified> catalogue migrate`, after fix, first pass | exit 1: 3 failed, 81 passed (84). Probe (g)/(e) failed on retired literal text, and catalogue 0074 failed because the list lacked my trigger; I then fixed the catalogue test. | `03-after-fix-api.log` |
| 04 | the same set with the adapted probe and fixed catalogue test | **exit 0: 85/85** (7 files) | `04-after-fix-api.log` |
| 05 | `with-pg.sh … apps/api/test/integration/automation` (all), sensitive-reference-inventory, sensitive-reach-sweep, `contract/contract.test.ts`, `hardening/integrity-sweep.test.ts`, `jobs` (job-operations, job-schedules), `operations` (exceptions, exception-recurrence-race = the **BE-Z6 race**, concurrent-exception-recurrence, exception-last-known-value, freshness-scan, log-redaction, service-identity-scope) | **exit 0: 25 files, 265/265** | `05-after-fix-api-related.log` |
| 06 | `with-pg.sh …` worker `automation-failure-queue`, `job-runs`, `outbox`, `starters`, `operations-freshness`, `connector-failure-exception`, plus `tests/qa/integration/a13-starter-jobs.test.ts` | **exit 0: 7 files, 59/59** | `06-after-fix-worker.log` |
| 07 | Final tree (after prettier): token suites, adapted probe, inventory, catalogue, migrate | **exit 0: 8 files, 87/87** | `07-final-tree-api.log` |
| 10/12 | `pnpm -r build` | exit 0 | `10-build.log`, `12-build.log` |
| 11 | `pnpm -r typecheck` | exit 0 | `11-typecheck.log` |
| 13 | `pnpm lint` | exit 0 | `13-lint.log` |
| 14 | `pnpm openapi:lint` | **exit 0**: "PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 932 operations" | `14-openapi-lint.log` |
| 15 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | exit 0: "All matched files use Prettier code style!" | `15-prettier-check.log` |
| 16 | `pnpm test`, locale unset (`env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE`) | **exit 0**: unit-node 191 files, 2902/2902; unit-web 125 files, 2105/2105; unit-formula-nocodegen 3 files, 259 passed, 2 skipped (261) | `16-pnpm-test-locale-unset.log` |
| 17 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | **exit 0**: same counts | `17-pnpm-test-c-utf8.log` |
| 18 | `with-stack.sh npx playwright test e2e/a22-p6-operability.spec.ts e2e/a13-automation-recovery.spec.ts --project=chromium-en --project=chromium-ar --workers=1` (real stack, built SPA and worker) | **exit 0: 4 passed** (4.0 min) | `18-e2e-a22-a13.log` |

Notes and disclosures:

- **openapi:lint.** My first attempt at check 14 ran `pnpm openapi` (exit 254), because my shell loop split the command on `:`. That was not the lint. It was re-run correctly (exit 0), and the log says so.
- **Skipped tests.** The 2 skipped tests are in the formula-nocodegen project. They are unrelated to this change.
- **Flakiness.** No test was flaky, and no run timed out.
- **Not run.** The full `pnpm test:integration` was not run; the brief says the orchestrator runs it on the merged tree.
- **No automation-recovery integration file.** No integration file is named "automation-recovery". The recovery path is covered by the worker `automation-failure-queue` file, the API `automation-failures` file and the e2e `a13-automation-recovery` spec, all run above.

## 5. Operations routed (pending-list delta)

None. No operation was added or moved, and no `p6-pending-*.ts` or `p6-exercises-*.ts` file changed. `contract.test.ts` stays green (log 05).

## 6. User-facing texts made untrue, and what I did

- **`problems.json` `automation_rule__restricted_token_stale` (en and ar), and the API problem detail.** The old text said the token was "issued from an earlier version of this draft". That is now only one of three cases. **Corrected in both languages:**
  - en: "A condition value is a restricted-record token that was not issued for this version as it now stands (it comes from an earlier save, another version or another rule): reload the version and re-apply your change."
  - ar: "قيمة أحد الشروط رمز سجل مقيد لم يصدر لهذا الإصدار بحالته الحالية (فهو من حفظ سابق أو من إصدار آخر أو من قاعدة أخرى): أعد تحميل الإصدار وأعد تطبيق تعديلك."
  - The Arabic is provisional, as before. The API detail is identical to the en text.
- **The field-error message** became "Restricted-record token not issued for this version as it now stands."
- **`workflowsP5.rules.changedReapply`** stays true; it is unchanged.

## 7. For the orchestrator (contract, schema, dependency)

- **Schema:** migration **0127** (`0127_p6_automation_restricted_token_key.sql`). Renumber at merge if another task shipped 0127 (D-196). If renumbered, also update:
  - the filename in the data dictionary section;
  - the "0127" label in `catalogue.test.ts`;
  - the comments in `schema.ts`, `versions.ts` and ADR-0051 part A.
- **Deploy effect:** every token issued before 0127 becomes stale (422). The editor reloads and asks the author to re-apply. No stored data changes.
- **Contract:** the response shape and zod mirrors are unchanged; the token text is a string in both. The OpenAPI descriptions are updated.
- **No new dependency.** HMAC is `node:crypto`; the random key is core PostgreSQL.
- **No new e2e spec**, so no new e2e budget.
- **Ownership note:** I touched ADR-0043 with one sentence (§2), web comments and web tests, and `problems.json`. The brief names the web editor in item 2, and the text correction is required by F-DG4-160.

## 8. What remains

Nothing from the brief. These are for the round-11 reviewers, not open work:

- Item 2's "the editor treats a token as opaque" is met: the web only pattern-matches the token to show the label, and sends it verbatim. The real-browser flow was not re-run with a pasted token. It is covered by the jsdom test in en and ar, and the a13/a22 e2e specs pass.
- The domain reviewer's Playwright probe (`dom-r10-editor-tokens.spec.ts.txt`, part C) was not re-run. It asserts the D-231 literal text and would need its literals moved, as in the API probe.
