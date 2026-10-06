# Handback T-DG2-BE6: invisible-only free text (backend-workflow-engineer)

- **Stage:** P2 / DG2 (FIXING), round-4 repair. Branch `claude/mobily-transformation-platform-regate`.
- **Base:** `HEAD` = `81670e49738c6bc63e360e870ffec61b4610d660` (verified with `git rev-parse HEAD` before writing). The changes are uncommitted in the working tree; the orchestrator integrates them.
- **Assignment:** `docs/delivery/assignments/DG2/round-4/T-DG2-BE6.md` (sha256 `ddd481c5…bae214b`, verified).
- **Invocation:** `DG2-T-DG2-BE6-backend-workflow-engineer-20261006T062035Z-82ffc656`, session `82ffc656-2161-4d97-a46f-d7b48d721a81`.
- **Finding repaired:** F-DG2-160 (Low, REQ-PB-031; residual of F-DG2-150 / D-063). I authored this fix, so I don't close the finding; the orchestrator records `import-findings --fix`.
- **Frozen files:** untouched. `docs/api/openapi.yaml` and migrations 0010-0019 are not modified. There are **no new migrations and no new API endpoints**.

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/common.ts` | New single predicate `hasVisibleContent` (regex `/[^\p{White_Space}\p{Cf}ᅟᅠㅤﾠ⠀]/u`), with a comment citing F-DG2-160 that lists the exact set. `hasText` and the `freeText` refinement both use it now; `trim()` is gone from both. |
| `packages/shared/src/schemas/charter.ts` | `composeThesis` (via `thesisPartText`) uses `hasText`, so an invisible-only thesis part is incomplete. Without this, the same gap would have remained in the thesis warning. |
| `packages/shared/src/schemas/schemas.test.ts` | Unit matrix: 16 finding code points plus NBSP, U+2028 and U+3000, each alone, repeated and mixed with spaces. Every case is rejected (`validation.blank`) and not present. A mix of all of them on charter, T01 and gate-decision fields is rejected. Mixed visible plus invisible input is accepted, present and stored verbatim: Arabic with RLM/ALM, emoji ZWJ sequences, a leading or trailing ZWSP, a single character, and `<invisible>a<invisible>` for every listed code point. An invisible-only thesis part is incomplete. |
| `apps/api/test/integration/blank-text.test.ts` | New `describe` for F-DG2-160 on PostgreSQL (details in section 2). |
| `apps/api/src/modules/transformations/exclusions.test.ts` | `hasExclusions` cases for RLM-only, NEL-only, WJ×3 and ALM-only input (no exclusion), Arabic with RLM (an exclusion), and parity with `hasText` on invisible input. |
| `apps/api/src/modules/transformations/charter.ts`, `apps/api/src/modules/workflows/criteria.ts` | Comment-only: they describe the "visible content" rule instead of "trimmed". There is no logic change; both already call `hasText`. |
| `apps/web/src/components/Section.tsx` | `TextCell` shows "None" through the shared `hasText`, so an invisible-only legacy value isn't rendered as content. |
| `apps/web/src/test/p2fixtures.ts` | The mock pre-check mirrors the server with `hasText` instead of `trim()`. |
| `apps/web/src/lib/lib.test.ts` | Client-side schema test: RLM, NEL, WJ×3, ALM and ZWSP+fillers each give `validation.blank`; Arabic with RLM is accepted verbatim. |
| `apps/web/src/pages/p2.test.tsx` | Component test in EN and AR: an invisible-only Root cause in the T01 edit form shows the localized `validation.blank` message, the field gets `aria-invalid="true"` and **no PATCH is sent**. |
| `docs/architecture/adr/ADR-0017-charter-versioning-and-direction.md` | §2: new bullet "What 'blank' means (F-DG2-160)", meaning no visible content (White_Space, Cf, invisible fillers) and nothing stripped. The Validation, Readiness, Web and `exclusions_present` wording now matches. |
| `docs/delivery/handbacks/DG2/T-DG2-BE6-evidence/*.log` | Check logs (68 KB). |

## 2. Behaviour delivered (REQ-PB-031, F-DG2-160)

- **One predicate.** `hasVisibleContent(value)` is true only when the value has at least one code point that is not `\p{White_Space}`, not `\p{Cf}` and not U+115F/U+1160/U+3164/U+FFA0/U+2800. `hasText` (`typeof value === "string" && hasVisibleContent(value)`) and `freeText(min, max)` (refine `v.length === 0 || hasVisibleContent(v)`, code `validation.blank`) both use it. So every P2 `freeText` field (the API 400 and the web client-side validation) and every `hasText` readiness test agree:
  - the B0041 exclusions pre-check (`hasExclusions`);
  - G1 `g1.initial_charter`, case for change and the T01 current state, root cause and impact text;
  - KPI baseline source (`gate-facts.ts`, `baselines.ts`);
  - the good outcome causal chain;
  - the thesis.
- **Nothing is stripped.** Accepted values are stored verbatim, marks included. An empty string still fails only `min` (one error). `null` still clears.
- **API, on PostgreSQL (`blank-text.test.ts`).** For an Out of scope of `"‏"`, `"\u0085"`, `"⁠⁠⁠"` or `"؜"`:
  - **Create:** `POST …/charter` returns 400 `validation` with `{pointer: "/outOfScope", code: "validation.blank"}`. No audit row exists for the request id, and `GET` still returns 404, so no charter was written.
  - **Update:** `PATCH …/charter` with `If-Match: "1"` returns the same 400. The charter keeps version 1 and its previous Out of scope, and its audit trail is unchanged.
- **Arabic Out of scope with RLM marks** (`"‏قطاع الشركات خارج النطاق (بيانات اصطناعية)‏"`): 201 and stored verbatim (POST and GET). `exclusions_documented` reads `pass`, and G1 `g1.initial_charter` does not list `/charter/outOfScope`.
- **Defense in depth.** The same test writes `"‏​"` around the API, as an audited system/migration write with a snapshot. The pre-check then reads `attention`, and G1 lists `/charter/outOfScope` as missing.
- **Web.** The shared schemas catch invisible-only input client-side: no request is sent, and the existing EN/AR `problems.validation__blank` message appears on the field (`p2.test.tsx`, both locales). The RecordForm still sends whitespace-only input as `null` (unchanged BE5 behaviour). Invisible-only input is not whitespace for `trim()`, so it reaches the schema and is blocked there.
- **Conventions.** No mutation path changed. Authz, If-Match/409 and the audit event stay as they were, and the new tests confirm that a rejected request writes neither data nor audit. All test data is synthetic. G1 is a product business gate and is unrelated to DG0-DG7.

## 3. Checks actually run

Environment: offline sandbox, Node v24.21.0 unless stated otherwise, disposable PostgreSQL 16 started by the harness scripts. Logs are in `docs/delivery/handbacks/DG2/T-DG2-BE6-evidence/`. I couldn't write under `docs/delivery/test-evidence/DG2/` ("Read-only file system" for an implementer), so the logs sit next to this handback, as with T-DG2-FE4.

| Command | Result |
|---|---|
| `pnpm -r typecheck` | **exit 0** (`typecheck.log`) |
| `pnpm -r build` | **exit 0** (`build.log`) |
| `pnpm lint` | **exit 0**, `--max-warnings=0` (`lint.log`) |
| `pnpm format:check` | **exit 2**. Every file it could read is formatted ("All matched files use Prettier code style!"); the only errors are EACCES on 12 sandbox-masked untracked dotfiles (`.bash_profile .bashrc .gitconfig .gitmodules .idea .mcp.json .profile .ripgreprc .vscode .zprofile .zshrc CLAUDE.local.md`) (`format-check.log`) |
| `pnpm exec prettier --check . --ignore-path .prettierignore --ignore-path <those 12 paths>` | **exit 0**: "All matched files use Prettier code style!" (`format-check-ignore-path.log`) |
| `pnpm openapi:lint` | **exit 0** (`openapi-lint.log`) |
| `pnpm test` on Node v22.22.2 (`/opt/node22/bin`) | **exit 0**: `Test Files 31 passed (31)`, `Tests 550 passed (550)` (`unit-node22.log`) |
| `pnpm test` on Node v24.21.0 | **exit 0**: `Test Files 31 passed (31)`, `Tests 550 passed (550)` (`unit-node24.log`) |
| `npx vitest run --reporter=verbose <4 files> -t "F-DG2-160\|invisible\|equals hasText\|exclusion"` | **exit 0**. All the new F-DG2-160 unit, web and component tests are listed as passed (`targeted-unit-tests.log`) |
| `QA_PG_PORT=55471 tests/qa/support/with-pg.sh pnpm test:integration` | **exit 0**: `Test Files 29 passed (29)`, `Tests 461 passed (461)` (was 456; +5 in `blank-text.test.ts`, now 17/17). `contract/contract.test.ts` passed 11/11, including `expect(operations).toHaveLength(161)` (`integration-run.log`) |
| `E2E_PG_PORT=54491 E2E_API_PORT=3491 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers E2E_SCREENSHOT_DIR=$TMPDIR/shots apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/journeys.spec.ts apps/web/e2e/p2-journeys.spec.ts --project=chromium-en --project=chromium-ar --workers=1` | **exit 0**: `42 passed (2.9m)` (`e2e-run.log`). Pre-installed Chromium; `playwright install` was not run. Screenshots went to scratch and were not kept. |
| `node tools/gates/validate.mjs --historical --stage DG1` | **exit 0**: `PASS gate DG1 (historical)` (`validate-dg1-historical.log`) |

## 4. Known gaps / not done

- **Scope boundary.** The P1 `name` and `reason` schemas (`common.ts`: `z.string().trim().min(…)`, used by admin/P1 records and `reasonRequest`) and the inline `reason` in `register-kit.ts` still use `trim()`. They aren't `freeText` fields, F-DG2-160 doesn't name them, and changing them alters P1 contract behaviour. They would accept for example `"‏‏‏"` as a reason. I left them unchanged and suggest a follow-up observation if the reviewers want the same rule there.
- **Message wording.** The EN/AR `validation__blank` text ("Enter some text; spaces alone are not a value.") was kept as the assignment requires. It says "spaces", but it also covers invisible-only input.
- The reviewer probe `zz-sec-r3-invisible.test.ts` was not re-run as such; the new integration tests cover its cases.

## 5. Merge instructions

- No migrations, no OpenAPI change, no new endpoints, no config change.
- **Behaviour change for API clients.** A P2 free-text value with no visible content now returns 400 `validation.blank`, where it used to return 201/200. The repository's seed, tests and e2e send no such values.
- I expect no conflicts; no other agent ran at the same time.
