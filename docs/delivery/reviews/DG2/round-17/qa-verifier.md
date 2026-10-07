# DG2 round 17 — qa-verifier narrative

- **Task:** T-DG2-REV-QA-R17.
- **Candidate:** `sha256:ddaab3cc264b0e13caadcb17f0d1811eff8ad1ec9364b7ba9c03727b83350750` (564 files).
- **Source:** `805da3e2`.
- **Run:** `DG2-T-DG2-REV-QA-R17-qa-verifier-20261007T185506Z-4af87c30`.
- **Verdict: PASS.** No new finding. F-DG2-580 is CLOSED_VERIFIED.
- All data is SYNTHETIC. Nothing here is a business, Finance or IT approval. Product gates G1–G6 are untouched and imply nothing about DG0–DG7.

## 1. Candidate and independence

- **Start.** HEAD was `23edabfb`, the freeze and assignment commit, a child of `805da3e2`. Its diff against the source commit touches only:
  - the three round-17 assignments;
  - the manifest;
  - `stages.json`.
- **End.** HEAD was `7937c78b`, after the other reviewers' auto-commits.
  - None of the 181 files changed since `805da3e2` is a manifest entry.
  - The candidate ID recomputes identical on HEAD, at `--ref 805da3e2` and in all three disposable clones (`00-candidate*.log`).
- **Other reviewers' records.** A `git diff --name-only` listed the file names of code-security's round-17 files. I did not open any other reviewer's round-17 record or evidence.
- **Cleanup.** All clones and test scratch under `$TMPDIR` were removed at the end.

## 2. F-DG2-580: verified closed

I re-ran my round-16 spec unchanged (`dg2-qa-r16.spec.ts`, sha256 `408a6a14…`) on the real stack (`e2e/support/qa-stack.sh`), in chromium-en and chromium-ar, in both locale settings.

**R16-06 passes in all 4 runs.** Its assertions:

- A's 201 is real: the server committed A's Finance record, and B (dev.lead) reads it as 404.
- After delivery, tab 1 shows B's header.
- The DOM observer recorded no moment with A's new record's name as text.
- A's code is not in the document.
- The path is not `/transformations/<A's id>`.
- It is the same document throughout, with no page error.

**The screenshots** (`screens/*-qa-r16-06-after-delivery.png`) show B's header above B's own empty create form, in EN LTR and AR RTL.

**Negative control.** This is the same file that failed 4/4 on candidate `0cab0a8c` in round 16 (`round-16/19-r16-06-*.log`).

R16-01 to R16-05 also pass, 6/6 per project per setting.

## 3. New negative checks (D-077 regression focus)

`dg2-qa-r17.spec.ts` (sha256 `f6b3aaa8…`) has 13 tests. Each runs in 2 projects × 2 settings, and all pass.

**Method:**

- The in-flight writes are real: they are sent to the API at once and committed. Only their delivery to the page is held.
- A second, real tab signs A out and B in.
- An observer records any moment where A's text is under B's header.
- A 20 ms timeline records the path, the header and the data-states.

| Test | Path | Result |
|---|---|---|
| R17-01 | Create; tab 1 learns of B by an in-app navigation before A's 201 | Stays on `/my-work`. A's code and name are never shown. |
| R17-02 / R17-03 | Edit / archive answered while tab 1 still believes it is A | A's own handler moved the tab to A's record, or kept it there, before tab 1 could know. The next `/me` showed B, who got not-found. No moment shows A's text under B's header. |
| R17-04a / R17-04b | Organisation create, learn-first / deliver-first | B is not navigated to A's organisation. Its code and its names (EN and AR) never show. |
| R17-05a / R17-05b | User save, learn-first / deliver-first | B never sees A's change. In deliver-first no GET follows the PATCH, so the tab rightly keeps A's own screen until the next navigation reveals B. |
| R17-06a / R17-06b | In-app navigation at once / 5 s after another sign-in | The first request is `GET /me`. No page GET is sent before it answers. B's header shows over B's data. |
| R17-07 | In-app session end | Exactly one router write to `/login` (`pushState /my-work`, `replaceState /login`). 2 `/me`. The localized alert shows, the URL stays on `/login`, and no shell remains. |
| R17-08 | 403 | A no-permission read and a real 403 `csrf` are never a session end. After an in-app navigation, the same person's save updates and navigates. |
| R17-09 | Same identity | The organisation create lands on its page (EN name in EN, Arabic name in AR). The user save shows "Saved." |

**Header and data after a refocus.** The refocus case is R16-05, which passes.

**Earlier rounds.** Every other R8–R16 test passes, with the single exception in §4.

## 4. The one failing earlier test: R15-04's last step (explained, not a regression)

- **What failed.** In both full runs, my round-15 test R15-04 failed in both projects at its last step only (line 428). It expected the second language switch to show the "not saved" notice again.
- **What still passed.** Every earlier R15-04 assertion passed:
  - the real 403 `csrf`;
  - the notice in the shown language;
  - staying signed in with the list rendered;
  - the route-replaced 403 detail read not ending the session;
  - Back;
  - `/me` ≤ 2.

**Diagnostic R17-10** (`dg2-qa-r17-diag.spec.ts`, in a separate clone, both settings, both projects) measured the cause:

1. The same person signs in again.
2. The first PUT carries token X and gets 403 `csrf`. The notice shows, and the user stays signed in.
3. FE15's `/me` on the in-app navigation returns the same person with token Y (D-077 (3)).
4. The second PUT carries Y and gets **200**. No notice shows, and the server's `preferredLocale` is the chosen language.

**Conclusion.** The missing notice is correct.

- R15-04's last step encoded the pre-FE15 assumption that the stale token survives until a refocus.
- It is an obsolete expectation in my test, not a product regression.
- FE11/FE12's guarantees hold: a 403 is never a session end, and a *refused* save shows the notice.
- R17-10 supersedes that step.

## 5. Observation: D-077's declared 2 s residual (not a finding)

- **What happened.** In spec development run 1, an organisation create whose identity switch and answer both came within 2 s of tab 1's last `/me` ended with B on `/admin/organizations/<A's new id>`, seeing "no permission".
- **How it happened** (timeline in `18-r17-spec-dev-run2.log`):
  1. The post-create list refetch went out without a recheck (inside the window).
  2. The handler navigated the tab, which still showed A.
  3. That navigation's `/me` revealed B about 20 ms later.
- **What B saw.** No name and no code; only the opaque id in the URL.
- **Outside the window.** With a 2.5 s wait (R17-04b) the recheck stops the navigation.
- **Why it is not a finding.** This is the residual that D-077 (4) declares and offers to reviewers. It needs another tab to sign out and sign someone else in within 2 s of tab 1's last `/me`, and it discloses no record content. D-077's reopen condition is "shown to disclose another person's data", and that is not met.
- **Characterisation.** R17-04c covers it in every run. It asserts what must hold even inside the window: no code or name under B's header, and no-permission at the end.

## 6. Regression results (all in the record's checks)

- **Static:** typecheck, build, lint (with FE15's rule), openapi 161 operations, no-cdn, format and contrast all exit 0.
- **Unit:** 7/7 runs, each 926 tests on 50 files, on Node 22 and Node 24, with one run under load. FE15's `session-bound.test.tsx` has 34 tests.
- **Integration:** 6/6 runs, each 652 tests. The named suites all pass. Every run carries the `server_encoding UTF8` line.
- **Migrations:** 0001→0019, idempotent.
- **Product e2e:** 74 per setting, including P1, P2, Define→G2, Design→G3, p2-blank-text and session-end, in EN and AR.
- **Default rate limits:** 4/4.
- **axe:** 0 serious/critical, error states included.
- **Validators:** register, pipeline and reconcile all PASS.
- **Residuals** (D-057 registry, D-058 CI, D-049 Keycloak): PASS on the offline/config surface, residual noted.

## 7. Requirements (32): where each is evidenced

| Requirements | Evidence (this round, both settings) |
|---|---|
| REQ-PB-003 (modes) | e2e journeys (create End-to-End/Modular), R16-04, R17-01 create form |
| REQ-PB-012, REQ-S10-001 (roles, access) | p2-journeys "Team: six governance roles", the auditor (AUD) read-only journey, R17-04/05/08 no-permission, integration access suites, dg2-qa-acceptance |
| REQ-PB-016/017/018, REQ-S04-003/004/005 (G1–G3, phase procedures) | p2-journeys Gates G1, approver 409, Define → G2, Design → G3; integration p2 gate suites |
| REQ-PB-023 to 028, REQ-S16-013 (diagnostic, capability, journeys, T01, baselines, value pools, entities) | p2-journeys Diagnose (six T01 dimensions, Unknown, Unquantified), dg2-qa-design-r2 (journey/process map), dg2-qa-acceptance, integration |
| REQ-PB-029/030/031/033/035/037 (charter, thesis, scope checks, North Star, 3–5 outcomes, guardrails) | p2-journeys Charter and Define → G2, dg2-qa-journey-r2, p2-blank-text |
| REQ-PB-034/036 (T02, good outcome test) | p2-journeys Define, integration |
| REQ-PB-038/039/041/042/043, REQ-S05-003 (TOM dimensions, T03, canvas, workshop → T04, decision log) | p2-journeys Design (ten boxes, per-dimension view, workshop → T04), integration |
| REQ-S13-012 (filename/link unverified) | p2-journeys Evidence and Gates G1 "unverified evidence", evidence integration suites |
| REQ-DLV-034 (P2 outputs and evidence) | all of the above, in EN and AR |
