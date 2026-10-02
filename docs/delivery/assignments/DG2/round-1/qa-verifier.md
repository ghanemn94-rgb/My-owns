# DG2 gate review — qa-verifier (round 1)

Task ID: `T-DG2-REV-QA-R1`. Independent QA verifier of the frozen **DG2** candidate. You may author tests under `tests/qa/**` and `e2e/**`, never product code.

## Candidate
- **candidate_id:** `sha256:8ef26b710e343ed3535934904bccd677eab87894bb2cb62d5fb7677d6a95355b` — verify `node tools/gates/candidate.mjs --stage DG2` (513 files). Complete clone.
- **manifest:** `docs/delivery/candidates/DG2/8ef26b710e343ed3.manifest.json`. **source_commit** `98a8d99`. Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 floor. Pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; never run `playwright install`).
- DG1 is APPROVED; `node tools/gates/validate.mjs --historical --stage DG1` must pass.

## Verify — derive checks from the acceptance criteria of all 32 DG2-final requirements
Run positive, negative, regression, bilingual and reliability checks. Cover at least:
- **T01–T04 persist all source columns** (REQ-PB-026/034/039/043); Confidence ∉ H/M/L → rejected; T02 without target date → rejected; T03 without dimension → rejected; T04 IDs D-01…, Status Open default.
- **Charter** (REQ-PB-029/030/031): 14 fields persist; a save creates a new version with history; invalid baseline date rejected; 3–5 top-outcome warning (REQ-PB-035).
- **REQ-PB-036 good outcome test:** an outcome "Launch new app" with no KPI fails with reasons; G2 readiness lists the failing outcomes; `goodOutcomePass` false while any criterion fails/unknown.
- **REQ-PB-033 North Star:** a second active North Star → 409; header shows it.
- **Baselines/value pools** (REQ-PB-027/028): metric/source/date; unquantified labelled, never 0; totals "partial: N unquantified"; Finance validation incl. the stale state.
- **Gates** (REQ-PB-016/017/018, REQ-S04-003/004/005, REQ-DLV-034, REQ-S13-012): G1 without charter rejected; filename-only/inaccessible evidence stays incomplete; non-approver → 403; submitter → 403; superseded submission → 409; approval advances the phase. Gates labelled business approval, never DG.
- **Roles/access** (REQ-S10-001, REQ-PB-012): the expanded role catalogue; a Workstream Lead on transformation X cannot read Y; AUD read-only — every P2 mutation → 403; accountability text matches B0018.
- **Modes** (REQ-PB-003): End-to-End/Modular with verbatim guidance; Modular requires entry phase.
- **TOM/design** (REQ-PB-023/024/025/038/041/042, REQ-S05-003): workstreams, heatmap, journeys/pain points, 10-box canvas + per-dimension view, workshop conversion.
- **REQ-DLV-034 e2e:** a full Diagnose→Design journey completes through native workflows, in **EN and AR**.
- **Entity group** (REQ-S16-013): create+read each entity through the API with authorization.

## Execute (real output; a missing tool/DB is BLOCKED)
1. Build + static: `pnpm -r typecheck`, `pnpm -r build`, `pnpm lint`, `pnpm openapi:lint`, `pnpm check:no-cdn`, `pnpm format:check`, `pnpm --filter @mth/design-tokens run check:contrast`.
2. Unit on Node 22 and Node 24: `pnpm test` and `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test`.
3. Integration on a disposable PostgreSQL (unique port) **twice** — deterministic; migrations 0001-0018; the DB guards fire; `contract.test.ts` green (all 160 ops routed+exercised; `p2-pending.ts` and `p2-pending-kpi.ts` both empty).
4. e2e (pre-installed Chromium, `--workers=1`, unique port): the P1 + P2 journeys green in **chromium-en and chromium-ar**; axe no serious/critical.
5. Register & pipeline: `node tools/gates/validate.mjs --register DG2`, `--pipeline`, `--reconcile`.

## Requirements to check (record EXACTLY these — all 32)
`REQ-PB-003`, `REQ-PB-012`, `REQ-PB-016`, `REQ-PB-017`, `REQ-PB-018`, `REQ-PB-023`, `REQ-PB-024`, `REQ-PB-025`, `REQ-PB-026`, `REQ-PB-027`, `REQ-PB-028`, `REQ-PB-029`, `REQ-PB-030`, `REQ-PB-031`, `REQ-PB-033`, `REQ-PB-034`, `REQ-PB-035`, `REQ-PB-036`, `REQ-PB-037`, `REQ-PB-038`, `REQ-PB-039`, `REQ-PB-041`, `REQ-PB-042`, `REQ-PB-043`, `REQ-DLV-034`, `REQ-S04-003`, `REQ-S04-004`, `REQ-S04-005`, `REQ-S05-003`, `REQ-S10-001`, `REQ-S13-012`, `REQ-S16-013`.

## Environmental residuals — do NOT record as BLOCKED gate checks
Live-registry install (REQ-DLV-042 AC-1, **D-057**), live GitHub-Actions CI (REQ-DLV-025 A24, **D-058**), keycloak (**D-049**): record the offline/config surface PASS and note the live effect as the documented residual. A BLOCKED check fails the gate round; if you genuinely cannot verify a requirement's available surface, that is a FAIL to raise, not a BLOCKED gate check for a documented residual.

## Record format (MANDATORY)
`docs/delivery/reviews/DG2/round-1/qa-verifier.json`: `assignment` = exactly `docs/delivery/assignments/DG2/round-1/qa-verifier.md` (bare path); `candidate_id` above; `reviewer_role: qa-verifier`; `round: 1`; `stage_id: DG2`; `checks_run[]` each `{id, environment, procedure, expected, actual, exit_status, result (PASS|FAIL|BLOCKED), evidence[]}`; `requirements_checked[]` exactly the 32 ids; `findings[]` only NEW ones (+ `.findings.json` if any); `verdict` PASS only if every requirement is verifiable with evidence and no unresolved Critical/High/mandatory remains.
