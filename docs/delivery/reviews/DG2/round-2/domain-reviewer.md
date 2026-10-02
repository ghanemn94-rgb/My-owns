# DG2 round 2: domain-reviewer narrative and handback (T-DG2-REV-DOM-R2)

> The assignment's handback path `docs/delivery/handbacks/DG2/T-DG2-REV-DOM-R2-domain-reviewer.md` is outside the domain-reviewer write scope; the write guard refused it. This narrative takes its place. The assignment contradicts the write scopes on this point.

- **Candidate:** `sha256:089a2a2fbe3675019b0c5faeb1cf66fd4ea3f7235fae2c2b4ddb5aaef6c9be69` (517 files; recomputed in the repo and in a disposable clone). source_commit `eb8163e2`; HEAD `f5a72b49` differs only by freeze/assignment metadata. `validate --historical --stage DG1`: PASS.
- **Verdict: FAIL.** There is one Medium, non-mandatory finding. There are no Critical or High findings and no mandatory violations.

## Findings
- **F-DG2-143 (Medium, REQ-PB-031, owner backend-workflow-engineer):** an empty Out of scope gives the pre-check result `unknown` (UI badge "Unknown") for "Are explicit exclusions documented?". The REQ-PB-031 acceptance requires it to fail. An empty Out of scope on a saved charter is a definite "no" to B0041, not missing data. Reproduced live: `test-evidence/DG2/domain/round-2/probe-exclusions.log`.
- **F-DG2-144 (Low, REQ-PB-017, owner frontend-ux-engineer):** gate titles repeat the code, e.g. "G2 – G2 - Direction" (GateDetailPage.tsx:74, GatesPage.tsx:70).

## What was verified as faithful
- **Verbatim seeds:** B0009 mode guidance; B0018 six roles; B0023 G1–G6; B0029 workstreams; B0031 T01 dimensions; B0039–B0043 scope questions; B0051 criteria; B0056 dimensions and design questions; B0062 canvas boxes and prompts.
- **Templates and charter:** the 14 charter fields; the T02 (7), T03 (6) and T04 (7) columns.
- **Sequencing:** product gates run strictly G1 → G2 → G3. Each approval advances the phase by exactly one step, and out-of-sequence submissions are refused with 422.
- **North Star:** exactly one current North Star. Two-sentence statements are rejected. The charter shows the current North Star and marks a superseded one as stale.
- **Thesis:** flagged incomplete for each empty part, and composed in the B0037 structure when complete.
- **Outcomes and G2:** the 3–5 top-outcomes warning works. "Launch new app" fails the good outcome test with reasons, and G2 readiness lists it. G2 is refused without guardrails.
- **Gate decisions:** submitter and non-approver decisions get 403; a decision on a superseded submission gets 409.
- **Values and states:** unquantified value pools are labelled as such; amounts are decimal strings; Unknown is rendered, never green.
- **Brand, language and wording:** the wordmark is provisional; EN is LTR and AR is RTL; no PMI or Mobily certification claims; product gates are labelled as business approvals and separate from DG0–DG7.

## Checks actually run
- Node 24.21.0 and Node 22.22.2: typecheck, build and lint exit 0; unit tests 492/492; contrast all pairs PASS.
- Own live API scenario on a disposable PostgreSQL 16.13 stack: 62/62 assertions OK (run 2). G1 and then G2 were decided by a synthetic Sponsor; the phase moved diagnose → define → design. Run 1 had 4 failures caused by my script's assumptions (log kept).
- Candidate P2 Playwright journeys, chromium-en and chromium-ar: 24/24 passed; axe reported no violations. Screens inspected.
- Residuals D-049, D-057 and D-058 (Keycloak, live registry, live CI) were not exercised. Per the assignment they are not BLOCKED gate checks.

All data is synthetic. The demo approvals approve nothing real and imply no engineering gate. The disposable clone and clusters were removed.
