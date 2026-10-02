# Assignment T-DG2-FE3: DG2 round-2 UI repairs (frontend-ux-engineer)

- **Stage:** P2 / DG2 (FIXING) on branch `claude/mobily-transformation-platform-regate`. **Base:** current `HEAD`. Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 floor; offline. Pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; never run `playwright install`). **Own only `apps/web/**`** (no dependency change). Do not touch `apps/api/**`, `packages/**`, `docs/**`. The backend repairs (BE3, KBE2) are merged; build against the live contract (`docs/api/openapi.yaml`, 161 ops) and `@mth/shared/schemas`.

The server side of these findings is done; wire the UI so each is fully resolved and e2e-verified:

1. **F-DG2-201 (High, REQ-PB-017) — KPI activation affordance.** The contract now has `POST …/kpi-definitions/{id}/activate` (operationId `activateKpiDefinition`). On the Define screen's KPI dictionary, add an **"Activate"** action for a `draft` KPI definition (offered to `kpi_definition.edit` holders; If-Match; shows the 422 reason when preconditions are unmet; AUD sees it read-only). An active definition shows its `active` status. This unblocks completing **G2** through native workflows — the e2e must now be able to drive Diagnose→Define→Design to a G2 (and G3) decision.
2. **F-DG2-203 (Medium, REQ-PB-030) — thesis.** The Charter screen must render the **composed four-part thesis sentence** the API now returns (B0037: "If we change […], then […] will improve, creating […], because […]"), and show each part; when a part is empty, show it as **incomplete** (not "None"/blank passing silently), consistent with the API's incomplete flag.
3. **F-DG2-204 (Medium, REQ-PB-033) — North Star on the charter.** The Charter screen's North Star field (5) must show the **current** North Star returned by the API; if the API marks a superseded/stale North Star, show it clearly as stale — never display a superseded sentence as the current one.

## Non-negotiable UX rules (unchanged)
AR-RTL + EN-LTR for every string (EN + AR namespaces); Unknown/Stale never 0/green; AUD read-only affordances (server is the real guard); `#0078FF` provisional; no public CDN; product gates G1–G6 are business approvals, never DG0–DG7.

## Self-verification (real output in handback)
`pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm --filter @mth/web test`, `pnpm --filter @mth/design-tokens run check:contrast`, and the e2e journeys (pre-installed Chromium, `--workers=1`, unique ports) **green in EN and AR**, including: a KPI activated through the UI; **G2 completed end-to-end** (the Diagnose→Define→Design journey reaches a G2 decision, exercising the activation + good-outcome + guardrails readiness); the composed thesis with an incomplete part shown; and the North Star shown current after a refinement. `node tools/gates/validate.mjs --historical --stage DG1` exit 0.

## Handback
`docs/delivery/handbacks/DG2/T-DG2-FE3-frontend-ux-engineer.md` — per-finding UI fix + files + every check's real output (EN+AR e2e, incl. the G2-completion journey).
