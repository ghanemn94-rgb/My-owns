# Assignment T-DG2-FE2: close the two P2 FE coverage gaps — mode guidance (REQ-PB-003) and the Team screen (REQ-PB-012 / REQ-S10-008) (frontend-ux-engineer)

- **Stage:** P2 / DG2 (BUILDING) on branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 floor; offline. Pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; never run `playwright install`). **Read your prior handback `docs/delivery/handbacks/DG2/T-DG2-FE-frontend-ux-engineer.md` §4 and `docs/architecture/p2-work-split.md` §4/§7.**
- Your T-DG2-FE screens are merged. This is a small follow-up to close two coverage gaps the DG2 reviewers will check against the 32 DG2-final requirements. **Own only `apps/web/**`** (no dependency change). Do not touch `apps/api/**`, `apps/worker/**`, `packages/**`, `docs/**`.

## Gap 1 — REQ-PB-003: verbatim mode guidance on the New-transformation screen (REQUIRED for DG2)
Acceptance (A01;A03): "the form shows the source 'When to use' and 'How' guidance for each mode; guidance text shows 'Run Phases 1-6 sequentially...' and 'Enter at the relevant phase...' **verbatim**." The API already enforces mode ∈ {End-to-End, Modular} and Modular-requires-entry-phase (BE). **You add the create-screen guidance.**
- On the **New transformation** screen (`Transformations > New transformation`), when the user picks a mode, show that mode's **"When to use"** and **"How"** guidance from the playbook mode table (the rows after B0008). Use the **source text verbatim** for the English copy:
  - **End-to-End** — When to use: "New enterprise or business-unit transformation". How: **"Run Phases 1-6 sequentially. Do not launch initiatives before the North Star, outcomes and target state are clear."**
  - **Modular** — When to use: "A transformation is already underway". How: **"Enter at the relevant phase, complete the minimum mandatory templates, then reconnect to outcomes and benefits."**
- Provide an accurate Arabic rendering in the AR namespace (mark it a provisional translation in a comment if needed); the **English strings must be the verbatim source** above (the acceptance checks the English verbatim text). Keep every string in i18next (no hardcoded copy) — but the EN values are the verbatim source text.
- Modular must require an entry phase in the form (the API rejects it otherwise with a validation error; surface that error on the field). Add/adjust the web unit test and a line in the e2e create journey asserting the verbatim guidance text appears for each mode.

## Gap 2 — REQ-PB-012 / REQ-S10-008: the Team screen (completeness; its `screen_api` names "Transformation > Team")
- Build `Transformations > Team` (a workspace tab) using the existing APIs: `GET /transformations/{id}/scoped-assignments` (team list) and `GET /role-accountabilities`, with `POST /transformations/{id}/scoped-assignments` to assign a named person to a role (TL/TO only; the server enforces who may assign). Show each role with its **accountability text** (B0018 verbatim, `isSourceText`) next to the assignment, per the requirement ("accountability text shown on the role assignment"). Names resolve from the team/users where readable, else the role + ref (as your owner pickers already do).
- AUD and non-assigners see it **read-only** (no enabled assign control); the server still returns 403. Bilingual AR-RTL/EN-LTR. Add a web unit test and an e2e step (EN+AR) covering the team list + accountability text + the read-only auditor view.

## Non-negotiable UX rules (unchanged)
AR-RTL + EN-LTR every string; Unknown/Stale never 0/green; AUD read-only affordances (server is the real guard); `#0078FF` provisional, provisional wordmark, no official Mobily logo; no public CDN; product gates G1–G6 are business approvals, never DG0–DG7.

## Self-verification (real output in the handback)
`pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm --filter @mth/web test`, `pnpm --filter @mth/design-tokens run check:contrast`, and the e2e journeys (pre-installed Chromium, `--workers=1`, unique ports) **green in EN and AR**, including the new verbatim-guidance assertion and the team-screen step. `node tools/gates/validate.mjs --historical --stage DG1` exit 0.

## Handback
`docs/delivery/handbacks/DG2/T-DG2-FE2-frontend-ux-engineer.md` — the diff, the verbatim guidance strings used (showing they match the source), every check's real output (EN+AR e2e), and confirmation that REQ-PB-003 and REQ-PB-012/S10-008 are now covered in the UI.
