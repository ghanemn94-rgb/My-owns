# Assignment T-DG2-FE5: DG2 round-3 repairs (frontend-ux-engineer)

- **Stage:** P2 / DG2 (FIXING), branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline. Use the pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) and never run `playwright install`.
- **Runs after BE6:** backend-workflow-engineer T-DG2-BE6 (F-DG2-160) has already been integrated before you start. It changed how `hasText()`/`freeText()` in `packages/shared/src/schemas/common.ts` decide "no visible content" (White_Space, Cf and invisible fillers instead of `trim()`); read its handback `docs/delivery/handbacks/DG2/T-DG2-BE6-backend-workflow-engineer.md`. No other agent runs at the same time as you. **Do not edit `packages/shared/**`, `apps/api/**` or ADRs.** For every client-side "is this blank?" decision, call the shared `hasText()` from `@mth/shared`, so the web and the server use the same predicate.
- **Findings:** full text in `docs/delivery/findings.json`. Reproductions are in the qa evidence `docs/delivery/test-evidence/DG2/qa/round-3/` and the qa specs `docs/delivery/test-evidence/DG2/qa/tests/round-3/e2e/dg2-qa-blank-r3.spec.ts` and `dg2-qa-blank-probe-r3.spec.ts`. Read them; do not edit them.

## Findings to repair

### 1. F-DG2-210 (Medium, REQ-PB-029): web forms silently turn whitespace-only text into null
`apps/web/src/components/RecordForm.tsx` maps `s.trim() === ""` to `null` before the request (`fromFormValue`, default branch). The charter create/edit form does the same, wherever it maps values. As a result:
- the localized `validation__blank` message (D-063) is unreachable;
- a whitespace Case for change creates a charter without that field;
- an edit with a whitespace Out of scope saves a content-free charter version (PATCH body `{changeSummary}` only);
- replacing an existing Out of scope with spaces **clears** it;
- T01 shows "There are no changes to save."

**Required behaviour, for every P2 free-text form field (RecordForm and the charter form):**
- **Truly empty input** (`""`) keeps today's meaning: no value on create, and an explicit clear (`null`) on edit when the field had a value.
- **Input that is non-empty but has no visible content** (`value !== "" && !hasText(value)`) is a **field-level validation error** `validation.blank`, shown inline with the existing localized message `problems.validation__blank`:
  - EN "Enter some text; spaces alone are not a value."
  - AR "أدخِل نصاً؛ المسافات وحدها ليست قيمة."
  - The field gets `aria-invalid` and `aria-describedby`. Focus moves to the first invalid field. **Nothing is submitted.**
- On edit, a field whose value did not change is never sent. Check that the charter form cannot send a PATCH that carries only `changeSummary` because blank fields were dropped; the blank case is now an error instead.
- Do not trim or alter text that has visible content. It is sent verbatim.

Tests:
- Unit/component tests in EN and AR for RecordForm and the charter form:
  - whitespace-only gives the inline message and no request (assert the mocked fetch was not called);
  - `""` on edit of a filled field sends `null`;
  - visible text is sent verbatim.
- e2e on the real stack (extend `apps/web/e2e/p2-journeys.spec.ts`, or add a P2 negative spec), in chromium-en and chromium-ar:
  - a whitespace Case for change on create shows the message and creates no charter;
  - a whitespace Out of scope on edit shows the message, writes no version and does not clear an existing value;
  - a whitespace T01 Current state shows the message.

### 2. F-DG2-211 (Medium, REQ-S15-012): error banner breaks list semantics (axe serious `listitem`)
`RecordForm.tsx:328` renders `<ul className="banner banner--error plain-list" role="alert">` with `<li>` children. `role="alert"` overrides the list role, so axe reports a serious `listitem` violation (WCAG 1.3.1) in EN and AR whenever the banner shows.

**Required:**
- Put `role="alert"` (or an `aria-live` region) on a **wrapper** element around a semantic `<ul>`, or render the messages without list items.
- Sweep `apps/web/src/**` for any other `role="alert"`/`role="status"` placed directly on a `<ul>`/`<ol>`, or for list items outside a list, and fix the same way.
- Add an e2e axe scan of the error-banner state in EN and AR. The journeys must show **0 serious/critical** violations including that state.

## Conventions (unchanged)
- Every user-facing string exists in AR (RTL) and EN (LTR).
- Unknown/Stale is never shown as 0 or green.
- `#0078FF` is provisional.
- No public CDNs.
- Never edit `tools/gates/**`, `tools/agents/**`, `.claude/agents/**`, `docs/source/**`, reviews or gate records.

## Self-verification (real output in the handback)
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check` (if it fails only on unreadable sandbox-masked dotfiles, also run the `--ignore-path` variant and show both)
- `pnpm test` on Node 22 **and** Node 24
- `pnpm --filter @mth/design-tokens run check:contrast`
- the web e2e P1+P2 journeys plus your new negative spec, in chromium-en and chromium-ar (`--workers=1`, unique ports, disposable PostgreSQL), with axe at 0 serious/critical violations

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-FE5-frontend-ux-engineer.md`: per finding, the fix, the files changed and every check's real output. Keep the evidence small (logs and at most a few cited screenshots).
