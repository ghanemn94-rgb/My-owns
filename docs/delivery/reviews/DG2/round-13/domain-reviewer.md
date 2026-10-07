# DG2 round 13: domain-reviewer narrative (T-DG2-REV-DOM-R13)

**Verdict: FAIL.** There is one new High finding, **F-DG2-480**. Candidate `sha256:6824b8b8…` (556 files), source `aa0a68f1`, freeze `5699f721`. All data is synthetic. The G1-G3 decisions are demo decisions and approve nothing real. They are unrelated to DG0-DG7.

## Source fidelity and operating logic: faithful

All 26 assigned requirements verify against `docs/source/playbook.md`. I checked them statically (row texts extracted straight from the playbook) and live, in EN (LTR) and AR (RTL):

- **Modes, roles and gates.**
  - The B0009 modes match verbatim; the "How" guidance follows the selected mode.
  - The six B0018 accountabilities match verbatim. "Business Owners" and "Workstream Leads" are named in the singular for a per-person role.
  - The B0023 names, questions and evidence are verbatim. G1→G2→G3 are strictly sequential (422 `gate.out_of_sequence`) and were decided live, with the phase advancing diagnose→define→design→mobilize. G1 needs its six outputs.
- **Charter.**
  - The B0035 charter has 14 fields.
  - The B0037 thesis is composed from four parts, and is flagged incomplete when a part is blank or invisible-only.
  - The five B0039-43 checks are in source order, and the B0041 check fails on empty exclusions.
- **Direction.**
  - Exactly one current North Star.
  - The 3-5 top-outcome warning shows.
  - The good-outcome test fails "Launch new app".
  - G2 is blocked at zero guardrails.
- **Diagnose and design.**
  - The B0029 workstreams (6), B0056 dimensions (10) and B0062 canvas prompts (10) are verbatim.
  - The T01-T04 columns persist, with decimal cycle time. Workshop items convert to an Open T04 only with an owner, and the per-dimension view is complete.
- **Invariants.**
  - Value pools are "unquantified" with a null amount, never 0.
  - There are no float columns, and #0078FF is marked provisional.
  - There is no certification claim, and only G1-G6 exist.

## D-073 repairs (server side): correct

- Evidence upload and download work and are byte-identical, in the API and in the EN and AR dialogs, with Arabic file names.
- Access reaching its end while the body streams gives **403** `forbidden`, audited as `authorization.denied`.
- An administrator's revocation gives **401** (the revocation also ends the sessions). A sign-out mid-stream gives **401**.
- In every refusal case nothing is stored and no `.part` is left, and a later upload works.
- SIGTERM during an upload: the API exits with code 0 after about 5 s with no settle warning, no partial file and no revision. After a restart the earlier file is unchanged and uploads work.
- Dev sign-in works for all five synthetic users and in the browser in EN/AR.
- The OIDC path (F-441) needs Keycloak (residual D-049) and was not exercised live.

## F-DG2-480 (High): session end leads to an endless blank redirect loop

The server refuses correctly, but the user outcome is broken.

**What happens.** After any 401 caused by a session ending while the SPA is open, the client bounces between `/login?…error=session_expired` and the original page indefinitely. Triggers include:
- the D-073 upload refusal;
- an administrator's revocation;
- a sign-out in another tab;
- by the same code path, idle or absolute expiry.

During the loop:
- the screen is blank, with no sign-in form and no localized message;
- the tab sends about 130-140 `/me` requests per second;
- only a manual reload recovers (control: about 0.4 s to the form).

**Under the product's default rate limits.** The ended session falls back to the per-IP bucket, which is exhausted in about 2 s. The tab then shows a stale signed-in shell with "Too many requests", and other sign-ins from the same IP are refused for the rest of the minute.

**Cause, by reading the code.** `LoginPage.tsx` runs `if (me.data) <Navigate to={returnTo}/>` on the stale cached `/me`, while `RequireSession` redirects back to `/login`. This code is unchanged since DG1 (`4cd9224`), and D-073 did not touch the web. Owner: frontend-ux-engineer.

## Honesty notes on my own runs

Every non-zero exit is explained in the record and in `env.txt`.

My own probe mistakes, kept as attempt logs:
- lint attempt 1 flagged only my `rv/` probe files;
- r13-delta-api attempts 1 and 2 used the wrong audit key, the ownership rule, and the assignment uniqueness rule;
- r13-shutdown attempt 1 ran at LOG_LEVEL=warn;
- r13-ui-withdrawn attempt 1 stopped sampling too early.

All the other non-zero exits are the F-DG2-480 symptom.
