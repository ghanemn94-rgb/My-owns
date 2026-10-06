# Assignment T-DG2-FE6: blank-text rule in the hand-written P2 forms (frontend-ux-engineer)

- **Stage:** P2 / DG2 (FIXING), branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. FE5 (`bfa1807`), BE6 and BE7 are integrated. No other agent runs at the same time.
- **Environment:** Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`; offline. Use the pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) and never run `playwright install`.
- **Out of bounds:** do not edit `packages/shared/**`, `apps/api/**` or ADRs.
- **Why:** this completes the F-DG2-210 class. Your FE5 handback (§4) lists hand-written P2 forms that do not use `RecordForm` and still `trim()` free text before sending, so whitespace-only input there is silently dropped or turned into null instead of being refused. One rule must apply to every P2 form, as D-063 and F-DG2-210 require. The forms are:
  - `apps/web/src/pages/gates/GateDetailPage.tsx`:
    - submission note (~line 430): a whitespace note is silently omitted;
    - decision rationale (~line 514): trimmed;
    - comments (~line 515): a whitespace comment is silently omitted.
  - `apps/web/src/pages/design/JourneysSection.tsx` (~lines 484-519): journey step `name`, `actor`, `handoffTo` and the cycle-time text. Whitespace `actor`/`handoffTo` silently become `null`.
  - `apps/web/src/components/RowActions.tsx` (~lines 105-113): the note.

## Required (the same rule as RecordForm after FE5)
For every free-text input in these forms, and in any other hand-written P2 form you find (sweep `apps/web/src/pages/{diagnose,define,design,decisions,gates,evidence,team}/**` and `apps/web/src/components/**`):
- **Truly empty `""`** keeps today's meaning: an optional field is omitted (or sent as `null` when clearing on edit), and a required field shows the existing localized required message.
- **Non-empty with no visible content** (`value !== "" && !hasText(value)`, using the shared `hasText` from `@mth/shared/schemas`):
  - shows an inline localized `problems.validation__blank` message (EN and AR);
  - sets `aria-invalid` and `aria-describedby` on the field;
  - moves focus to the first invalid field;
  - **sends nothing**.
- **Visible text** is sent **verbatim**, without `trim()`. The server applies the same rule and stores text as entered.
- **ReasonDialog** (`apps/web/src/components/ReasonDialog.tsx`, used for archive/remove/deactivate reasons): an invisible-only reason (for example `"‏‏‏"`) shows the localized `validation__blank` message. The shared `reason` schema now rejects it (BE7). Make sure the client-side check or the server's 400 `validation.blank` at `/reason` is shown on the field in EN and AR, not as a generic error.
- **P1 admin/transformation forms** (`apps/web/src/pages/admin/**`, `transformations/**`): leave their deliberate trimming alone. Only confirm that a server 400 `validation.blank` for `name`/`reason`/`displayName` (now rejected by BE7) is shown as the localized field message and not a generic failure. Fix the mapping if it is not.

## Tests
- **Component tests (EN and AR)**, for each form above:
  - a whitespace-only value and an invisible-only value (`"‏"`) give the inline message, `aria-invalid`, focus, and **no request** (assert on the mocked fetch);
  - visible text is sent verbatim;
  - `""` keeps today's behaviour.
- **e2e on the real stack**, in chromium-en and chromium-ar. Extend `apps/web/e2e/p2-blank-text.spec.ts`:
  - a whitespace gate decision rationale and a whitespace submission note show the message and write nothing (the gate state is unchanged);
  - a whitespace journey-step actor shows the message;
  - an invisible-only archive reason in ReasonDialog shows the message and archives nothing;
  - axe runs in every one of these states.

## Conventions (unchanged)
- Every user-facing string exists in AR (RTL) and EN (LTR).
- Unknown/Stale is never shown as 0 or green.
- No public CDNs.
- Product gates G1-G6 are business approvals and never DG0-DG7. These are synthetic test decisions only.
- Never edit `tools/gates/**`, `tools/agents/**`, `.claude/agents/**`, `docs/source/**`, reviews or gate records.

## Self-verification (real output in the handback)
- `pnpm -r typecheck`
- `pnpm -r build`
- `pnpm lint`
- `pnpm format:check` (plus the `--ignore-path` variant if only sandbox-masked dotfiles fail)
- `pnpm test` on Node 22 **and** 24
- `pnpm --filter @mth/design-tokens run check:contrast`
- the web e2e P1 and P2 journeys plus `p2-blank-text.spec.ts`, in chromium-en and chromium-ar (`--workers=1`, unique ports, disposable PostgreSQL), with axe showing 0 serious/critical violations
- a regression check: the new tests fail on the old code

## Handback
Write `docs/delivery/handbacks/DG2/T-DG2-FE6-frontend-ux-engineer.md`. For each form, give the fix, the files changed and every check's real output. Keep the evidence small: logs and at most two cited screenshots.
