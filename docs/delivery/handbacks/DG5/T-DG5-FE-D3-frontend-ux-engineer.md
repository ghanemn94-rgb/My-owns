# Handback T-DG5-FE-D3 (frontend-ux-engineer): repair task, D-164 d and D-165

- **Stage:** P5, gate DG5 (BUILDING). Branch `dg5/fe-d3`, base `457e0ca` (D-165). The changes are **uncommitted**, for the orchestrator to integrate.
- **Invocation:** `DG5-T-DG5-FE-D3-frontend-ux-engineer-20261017T093205Z-b30c685f`, session `b30c685f-83cd-4b0f-9d1b-06b11fcdb6f9`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-FE-D3.md`, sha256 `99ba1b55…2bb2dd` (verified).
- **Time:** started `2026-10-17T09:32:19Z`, handback `2026-10-17T10:41Z` (about 70 minutes).
- **Preceding gate:** `node tools/gates/validate.mjs --historical --stage DG4` → `PASS gate DG4 (historical)`, exit 0 (`T-DG5-FE-D3-evidence/validate-dg4-historical.log`).
- **Gates:** no product gate G1–G6 was granted or recorded. All data in the tests and e2e is synthetic, and no screen shows a DG0–DG7 label.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/web/src/pages/automation/RulePage.tsx` | Scope 1. A new exported `dryRunTemplate(trigger, transformationId)` builds the dry-run sample from the trigger's `samplePayload`, with its `transformationId` set to the rule's transformation. Without `samplePayload` it falls back to the old condition-field template. `SAMPLE_TRANSFORMATION_PLACEHOLDER` is exported. Changing the sample trigger now drops an edit made for the previous trigger. |
| `apps/web/src/pages/automation/fed.test.tsx` | Scope 1 unit tests, with a stubbed catalogue: 2 × en/ar plus 1 pure-function test |
| `apps/web/src/styles/app.css` | Scope 2: `.banner .link` (replaces `.banner--error .link, .banner--warning .link`). Scope 4: an appended block for the failure queue (`[data-register="p5-automation-failures"]`) |
| `apps/web/src/components/form-framework/extension-hosts-twelve.test.tsx` (new) | Scope 3: one test per host for the twelve FE-C3 hosts, each in en and ar (24 tests) |
| `apps/web/e2e/fed3-automation.spec.ts` (new) | Scopes 1 and 4 e2e: the pre-filled `gate.submitted` dry run and its refusal; the failure queue at 1280 px |
| `apps/web/e2e/p5-launch-health-kpi.spec.ts` | Scope 5: waits for the first row before counting. The same race at the +7-day re-date check becomes a retrying `toHaveAttribute` |
| `docs/delivery/handbacks/DG5/T-DG5-FE-D3-evidence/**` | Logs and screenshots of my own spec only (D-162), plus one pre-fix failure screenshot that §3 cites |

- **Not changed:** `packages/design-tokens/**` (the fix is not a token change; see §2.2), `problems.json`, every en/ar i18n file, `RegisterTable`, every host page, every `tests/qa/**` and root `e2e/**` file.
- **No new dependency.**
- **Housekeeping:** I removed three empty `.claude/.cc-writes` directories under `apps/web/src/` (and their empty `.claude` parents) before the tests, as the assignment requires.
- **Not mine:** the untracked files at the repository root (`.bashrc`, `.gitconfig`, `.idea`, `.mcp.json`, `CLAUDE.local.md`, …) are environment artefacts that were present before I started. Do not integrate them.

## 2. Behaviour delivered

### 2.1 Added scope 1 (D-164 d): the dry-run builder pre-fills a valid sample. Row REQ-S12-002

Acceptance text (verbatim): *"A06;A13: a dry-run creates no tasks; a failed execution appears in the queue and succeeds on retry without duplicating actions"*.

- **Pre-fill.** The Dry run panel's sample comes from the catalogue trigger's `samplePayload`, copied as served. When the rule has a transformation (a transformation-scope rule, chosen in the builder), the sample's top-level `transformationId` (the placeholder `00000000-0000-7000-8000-000000000000`) is replaced with it.
  - The key is replaced only when the sample has it. No key is ever added, because the outbox schemas are strict.
  - An organization-scope rule keeps the placeholder.
- **Fallback.** Without `samplePayload`, the sample is the same template as before (`transformationId` plus every condition field set to `""`).
- **Contract.** The type accepts `samplePayload?: Record<string, unknown> | undefined`. That matches BE-C4's `z.record(z.string(), z.unknown()).optional()` (read, not copied, from BE-C4's worktree), so the code typechecks before and after BE-C4 merges.
- **Hint text.** `workflowsP5.dryRun.payloadHint` (en *"The event's fields, as the trigger sends them. Synthetic data only."*, and its ar text) stays true: the pre-filled sample is the trigger's own fields, with synthetic ids. Unchanged.
- **Unit tests** (`fed.test.tsx`, with a stubbed catalogue):
  - **en and ar:** the textarea is exactly `{...samplePayload, transformationId: <rule's transformation>}` and no longer contains the placeholder. The hint is shown. *Run the dry run* POSTs `{triggerCode: "gate.submitted", payload: <that sample>}` and shows *"Nothing was created"*. `dir` is ltr or rtl.
  - **Pure function:** an organization rule keeps the placeholder; no `samplePayload` gives the fallback template; a sample without `transformationId` gets none added.
  - The existing fallback test (`gate.decided` without a sample) still passes unchanged.
- **e2e** (`fed3-automation.spec.ts`, "Dry run: …"), live and in both projects:
  - The catalogue serves `gate.submitted.samplePayload` with the placeholder.
  - dev.nobody, with synthetic grants (ADM_METHOD on the organization, plus WL on a new synthetic transformation so the builder can select it), creates a transformation-scope `gate.submitted` rule in the builder.
  - The pre-filled sample equals the served one with the selected transformation.
  - **Main refusal:** `{}` gives the alert `data-problem="automation.dry_run_sample_invalid"` with its en/ar text, and no result.
  - **Main path:** after a reload, the pre-filled sample runs to `data-dry-run-result="pass"`, *"Nothing was created"* and the Pass chip.
  - It also checks axe, `dir`, no DG0–7 text and no foreign request. Both grants are revoked in `finally`.
  - **Result:** this test **cannot pass on this branch alone**, because the server does not serve `samplePayload` until BE-C4 merges. See §3.3 for both runs.

### 2.2 Added scope 2 (D-165; QA-B P-2): contrast of the banner link. Row REQ-S15-003

Acceptance text (verbatim): *"A20: the contrast test lists every pair and passes; white small text on #0078FF is not used for action buttons; status chips are distinguishable in greyscale"*.

**Why en and ar differed.** The colours are the same in both languages. Before the fix I reproduced it in a disposable clone (§3.4), logging the computed style and axe's `color-contrast` result for the banner link in both projects:

- **en:** the link computes to `rgb(0, 109, 233)` = `#006DE9`, on `#E8F1FC`. axe reports a violation: *"insufficient color contrast of 4.22 … Expected 4.5:1"*.
- **ar:** the same `rgb(0, 109, 233)`, the same 16 px, the same weight 500. axe lists the link as neither a violation nor *incomplete*: it did not evaluate that node.

So the ar "pass" was an axe false negative, and the defect existed in both languages. The only language-dependent rule is `html[lang="ar"] { font-family }`.

- **Probable cause (inferred, not proven):** axe excludes some text from `color-contrast` with a glyph heuristic (icon-ligature detection), and the shaped Arabic run in IBM Plex Sans Arabic probably trips it.

**Cause in the styles.** `.link` uses `action.primary` (`#006DE9`). The contrast check pairs that token only with `surface.card` and `surface.page`, never with a banner background. Info and success banners had no link rule; error and warning banners did.

**Fix.** `.banner .link { color: inherit; text-decoration: underline; }` applies to every banner kind. A link now takes its banner's own text colour, which is already a checked token pair, and is underlined, so it is never told apart by colour alone:

| Pair | Contrast (from `contrast.log`) |
|---|---|
| `feedback.info.fg` `#003B73` on `feedback.info.bg` `#E8F1FC` | 9.83:1 |
| `text.primary` on `feedback.info.bg` (inside a paragraph) | 13.75:1 |
| `feedback.success.fg` on `feedback.success.bg` | 5.76:1 |
| error and warning | unchanged |

- Both pairs were already in `contrastPairs`, so no token or pair changed. `check:contrast` still reports 50 pairs (exit 0).
- **Live result:** `e2e/a07-historical-integrity.spec.ts` (unchanged) passed in **both** chromium-en and chromium-ar with the fix (`e2e-touched.log`, tests 13 and 26). Before the fix, A07 failed in en (`a07-PRE-FIX-diagnosis.log`, `screenshots/en/a07-PRE-FIX-superseded-banner-failure.png`).

### 2.3 Added scope 3 (D-165; FE-C3 §9.3): the twelve hosts' tests. Row REQ-S06-004

Acceptance text (verbatim): *"A06: an admin adds a field to T13, changes a validation rule and changes an approver route in the UI; after publish, with no deployment or application-code change, a new T13 record stores the new field, the changed rule rejects a value it previously accepted, and a submission is routed to the new approver"*. These hosts extend that row's "works without code changes" to the remaining record types (FE-C3 §3).

**Test file.** `extension-hosts-twelve.test.tsx` runs one test per host, each in en and ar, with stubbed responses: `evidence`, `baseline`, `value_pool`, `resource_plan`, `funding_approval`, `change_request`, `meeting_record`, `corrective_plan`, `bau_handover`, `control`, `charter`, `tom_canvas`. Each test asserts that:

1. The published extension field's input renders in the host's **create form** (`[data-extension-create=<type>]`) and is labelled in the screen's language.
   - For `charter`, this is the create form shown before a charter exists (GET 404 `charter_not_found`).
   - `tom_canvas` has **no create path** (FE-C3 §2: the ten cells exist from the transformation's creation), so its test asserts the record view and the save only. This is stated in the file header.
2. The **record view** (`[data-extension-values=<type>][data-record-id=<id>]`) shows the stored value 42 with its label.
3. **Saving** the value from the record's Form tools sends `PUT …/form-records/<type>/<id>/custom-fields` with `If-Match: "1"` (the custom-value row's version) and the body `{values: {qa_d3_score: "60"}}`.
   - The create path's `If-Match: "0"` is already covered by FE-C2's and FE-C3's tests on the same framework lines.

**Mutation check.**

- **Mutations:** remove `{ext.node}` from `EvidencePage`'s create dialog, and set the TOM record view's `canWrite` to `false`. Both the evidence and the tom_canvas tests fail in en and ar (4 failed).
- **Restoration:** I reverted both files by hand, because `git checkout` cannot write the worktree index in this sandbox. `git diff` on both files is empty.

### 2.4 Added scope 4 (D-165; QA-F P-4): the failure queue at 1280 px. Row REQ-S12-002 (acceptance as in §2.1)

**Cause.** `.table .code { white-space: nowrap }` on the idempotency key, plus an unbroken technical error message, made the table's min-content width far wider than the window.

**Fix.** A narrower layout, scoped to `[data-register="p5-automation-failures"]`. The key (`.code`) and the error message (`[data-error-code] bdi`) wrap anywhere, so their min-content width shrinks. Queue and schedule codes keep their normal wrapping.

- **Keyboard and focus are unchanged:**
  - The row actions stay in the tab order.
  - On narrower windows the table still scrolls inside `.table-wrap`, which holds focusable controls, so axe's `scrollable-region-focusable` passes.
  - `RegisterTable` (not mine) is unchanged.

**e2e** ("Failure queue at 1280 px", both projects):

- **Setup:** viewport 1280×800, signed in as dev.admin on the real app. The list response is served **synthetic** rows through `page.route`: one open and one resolved failure, with long unbroken keys and messages as the worst case. A real failed execution needs a worker retry-limit change, which is A13's setup. This route stub is disclosed in the spec header.
- **Assertions:**
  - `.table-wrap` has no horizontal overflow (`scrollWidth - clientWidth ≤ 0`).
  - The Status and Actions header cells are inside the region and the window.
  - The open row's Retry and Dismiss buttons and its Open chip are horizontally inside the region and the window.
  - Retry takes focus.
  - It also checks axe, `dir` and no foreign request.
- **Without the fix** (CSS removed, web rebuilt), the same test fails in both projects: overflow is 992 px (en) and 1038 px (ar) (`e2e-fed3-failure-queue-WITHOUT-fix.log`).
- **Screenshots:** `screenshots/{en,ar}/fed3-failure-queue-1280.png`. I viewed both.

### 2.5 Added scope 5 (D-165): `p5-launch-health-kpi.spec.ts` waits for the rows. Row REQ-S14-004

Acceptance text (verbatim): *"A16: moving the start date by +7 days moves every unstarted task by 7 days and leaves completed tasks unchanged; a task whose predecessor is incomplete shows 'blocked by' the predecessor"*.

- **Line 68:** `await expect(window2.first()).toBeVisible()` now runs before the count. Every assertion is kept.
- **Same pattern elsewhere:** the +7-day check read `data-due` once, right after `[data-last-shift='7']` appeared, so the rows might not have re-rendered yet. It is now `await expect(… .first()).toHaveAttribute("data-due", <first due + 7>)`, which retries, with the same expected value.
- The other reads in the spec (the `firstDue` read, `evaluateAll` after the wait) already follow a rendered locator.
- **Result:** passed in both projects (`e2e-touched.log`, tests 3 and 16).

## 3. Checks (real exit codes; logs in `T-DG5-FE-D3-evidence/`)

### 3.1 Required checks

The final checks ran under **Node v24.21.0** (`PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH`; `node-version.log`), one at a time:

| Command | Exit | Result | Log |
|---|---|---|---|
| `node tools/gates/validate.mjs --historical --stage DG4` | 0 | PASS gate DG4 (historical) | `validate-dg4-historical.log` |
| `pnpm -r typecheck` | 0 | | `typecheck.log` |
| `pnpm -r build` | 0 | | `build.log` |
| `pnpm lint` | 0 | eslint, `--max-warnings=0` | `lint.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | | `prettier.log` |
| `pnpm openapi:lint` | 0 | PASS, 846 operations | `openapi-lint.log` |
| `pnpm --filter @mth/design-tokens run check:contrast` | 0 | 50 pairs pass; 3 prohibited pairs fail as documented | `contrast.log` |

**Disclosure: wrong Node at first.** I first ran these with the PATH's default Node v22.22.2 (also inside the engines range), before I noticed the assignment names 24.21.0. Those logs are kept as `node22-*.log`:

- typecheck, build, lint, openapi-lint and contrast: exit 0.
- prettier: first **exit 123**, because my two new files were unformatted. After `prettier --write` on them, exit 0.

All were then re-run on Node 24, as in the table.

### 3.2 Vitest (D-164 load rule: one project, one at a time)

`unit-web` is the only project my change reaches (web source, web tests, CSS). No API, worker, db or shared source changed.

| Command | Exit | Files | Tests | Log |
|---|---|---|---|---|
| `env -u LANG -u LC_ALL -u LC_CTYPE npx vitest run --project unit-web` | 0 | 86 | **1636 passed** | `unit-web-locale-unset.log` |
| `LANG=C.UTF-8 LC_ALL=C.UTF-8 npx vitest run --project unit-web` | 0 | 86 | **1636 passed** | `unit-web-C.UTF-8.log` |

- **Count delta:** D-165 recorded unit-web 1609. My change adds +27 = 24 host tests + 3 dry-run tests.
- **Not run, D-164:** the repository-wide `pnpm test`.

**Integration.** My change reaches no integration directory: no `apps/api/**`, `packages/db/**` or `tests/qa/**` file and no route changed. The QA tests named in my Added scope are e2e (A07), not integration. So no integration run applies, and no pinned count changes.

- **Not run, D-164:** `pnpm test:integration`.

### 3.3 e2e

All runs used `apps/web/e2e/support/with-stack.sh`, `--workers=1`, on my ports: PG 23951 or 23961, API 23952 or 23962, pool 23953–23999.

| Run | Exit | Result | Log |
|---|---|---|---|
| My spec and the touched pages' specs: `fed3-automation`, `p5-launch-health-kpi`, `p5-procedures-automation`, `p5-snapshot-page`, root `e2e/a07-historical-integrity` (Node 22) | 1 | **22 passed**, 4 failed: all four are mine, explained below | `e2e-touched.log` |
| `fed3-automation.spec.ts`, final spec, in this tree (Node 24) | 1 | Failure queue 2/2 passed; Dry run 0/2, failing at its first assertion | `e2e-fed3-final.log` |
| `fed3-automation.spec.ts` in a disposable **combined clone** (Node 24) | 0 | **4/4 passed** | `e2e-fed3-combined-with-BE-C4-samples.log` |
| Failure-queue test before the fix, run to prove the test | 1 | 2 failed, as intended: overflow 992 and 1038 px | `e2e-fed3-failure-queue-WITHOUT-fix.log` |
| Failure-queue test after the fix (Node 22) | 0 | 2 passed | `e2e-fed3-failure-queue.log` |
| A07 before the fix, in the clone, run to diagnose | 1 | en failed (4.22:1), ar passed | `a07-PRE-FIX-diagnosis.log` |

**`e2e-touched.log` results.**

- **Passed in both projects:** the launch, health and KPI spec (3 tests), the procedures and automation spec (6), the snapshot-page spec (1), and **A07** (1).
- **Failed:**
  - Both "Failure queue" tests: the stack served a stale mutated build. My log path was wrong after a `cd`, so the rebuild after the mutation check never ran (the shell said so). After a correct rebuild, the test passed (`e2e-fed3-failure-queue.log`, then `e2e-fed3-final.log`).
  - Both "Dry run" tests: the missing BE-C4 `samplePayload` (below).
- **A07 is valid evidence.** That stale build already contained the banner fix; the mutation touched only the failure-queue CSS.

**The Dry run e2e in this tree** fails at `expect(sample, "the catalogue serves gate.submitted's samplePayload (BE-C4, D-164 d)").toBeTruthy()`. BE-C4 serves the field in this same wave, and its change is not in this tree. This is expected and not a product defect of this task.

**The combined clone.** To exercise the spec end to end, I built a throwaway `git clone` under `$TMPDIR`, outside both worktrees:

- my diff, plus read-only copies of BE-C4's **in-progress** `apps/api/src/modules/automation/{catalogue,samples}.ts` and `packages/shared/src/schemas/automation.ts`;
- `node_modules` copied from my tree, because the pnpm store is read-only in this sandbox, so `pnpm install --offline` failed with EROFS.

There, all four tests pass. This is **non-binding**: it ran against BE-C4's unfinished files at about 10:15Z. The binding run is the orchestrator's, on the merged tree. Neither worktree was modified.

**Screenshots (D-162: my spec only, viewed).**

- `screenshots/{en,ar}/fed3-failure-queue-1280.png`: from this tree.
- `screenshots/{en,ar}/fed3-dry-run-sample.png` and `fed3-dry-run-refused.png`: from the combined clone.
- `screenshots/en/a07-PRE-FIX-superseded-banner-failure.png`: cited failure, pre-fix.

No trace or full-suite folder is committed.

**Not run, D-164:** the full web e2e and the root acceptance suite.

## 4. Operations routed

None. This task is web only. My pending list is unchanged, and I added no `p5-pending-*` or `p5-exercises-*` file. The contract-test pinned counts are unchanged.

## 5. Contract, schema or dependency needs (for the orchestrator)

- **Dependency:** none.
- **Contract:** nothing beyond D-164 d. The web reads the optional `AutomationTrigger.samplePayload` that BE-C4 adds.
- **Merge order:** merge BE-C4 before, or together with, FE-D3. Then `fed3-automation.spec.ts` "Dry run" passes on the merged tree. Without BE-C4, that test fails at its first assertion by design; there is no silent skip.
- **Problem codes:** none new. `automation.dry_run_sample_invalid` already has en/ar text in `problems.json` (line 719), and no key was added, so there is no duplicate-key risk.

## 6. User-facing texts

No text became untrue. `workflowsP5.dryRun.payloadHint` (en/ar) stays true (§2.1). No nav, landing or admin text calls these features "Planned". No i18n file changed.

## 7. What remains

1. **Dry run e2e:** it passes only after BE-C4's `samplePayload` is merged; it is verified non-bindingly in the combined clone. The orchestrator's merged-tree run is the binding evidence.
2. **axe's Arabic blind spot:** the axe colour-contrast check did not evaluate the Arabic link text (§2.2). Other Arabic-only text colours could hide the same way. A colour-only regression guard independent of axe (e.g. computed-style checks of link colour against the banner background) is a possible QA follow-up. Not done here, because it is outside my ownership (`tests/qa/**`, `e2e/**`).
3. **Not run, D-164:** `pnpm test`, `pnpm test:integration`, the full web e2e and the root acceptance e2e.

## 8. Merge instructions

- No migration. No conflict expected: the W20 tasks BE-C4, BE-T3 and KBE-D4 edit `apps/api/**`, `packages/db/**` and `packages/shared/**`; I edited none of these.
- `app.css` changes in two places: one replaced rule near the banner styles, and one block appended at the end.
- Rebuild the web (`pnpm -r build`) before any e2e.
