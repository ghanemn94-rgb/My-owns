# Handback: T-DG2-REV-DOM-R13 (domain-reviewer, DG2 round 13)

**Path note.** The assignment names `docs/delivery/handbacks/DG2/T-DG2-REV-DOM-R13-domain-reviewer.md`, but the write guard refuses that path for domain-reviewer ("outside role write scope"). As in round 12, the handback is written here, in my evidence directory. The assignment and the write scopes contradict each other on this point; I am reporting it here rather than working around the guard.

**Verdict: FAIL.** There is one new finding: **F-DG2-480** (High, not mandatory, owner frontend-ux-engineer, requirement REQ-S16-030).

| | |
|---|---|
| Candidate | `sha256:6824b8b8d36a688178a058c11c4882737a79cf7f39b438dcf2390eafb88d3afc` (556 files; recomputed in the repo and in the disposable clone before and after the runs) |
| Source / freeze | `aa0a68f1` / `5699f721` |
| DG1 historical | PASS |
| Invocation | `DG2-T-DG2-REV-DOM-R13-domain-reviewer-20261007T063903Z-5d6c8af9` |

## Changed files (review outputs only)

- `docs/delivery/reviews/DG2/round-13/domain-reviewer.json`: the review record. It validates against review.schema.json (ajv 2020).
- `docs/delivery/reviews/DG2/round-13/domain-reviewer.findings.json`: F-DG2-480.
- `docs/delivery/reviews/DG2/round-13/domain-reviewer.md`: the narrative.
- `docs/delivery/test-evidence/DG2/domain/round-13/**`: logs, probes, stack scripts, `env.txt`, the cited screenshots and this handback.

No implementation file was touched. There is no `.verifications.json`, because I had no open finding to verify.

## Behaviour verified

- **The 26 requirements are faithful to the playbook.** I checked them statically (row texts extracted from `docs/source/playbook.md`) and live on a disposable stack, in EN/AR. See checks DOM-R13-06 to 17.
- **The D-073 server behaviour is correct:**
  - EN and AR uploads and downloads are byte-identical.
  - Access ending mid-stream gives 403 (audited). Revocation or sign-out mid-stream gives 401. Nothing is stored and no `.part` is left.
  - SIGTERM during an upload exits 0 with no partial file, and evidence works after a restart.
  - Dev sign-in works for every seeded user, and in the browser in EN/AR.
- **F-DG2-480 breaks the user outcome.** After any session end while the app is open (the D-073 upload refusal, a revocation, a sign-out elsewhere), the web client loops endlessly between `/login?error=session_expired` and the page:
  - the screen is blank, with no form and no localized message;
  - the tab sends about 130-140 `/me` requests per second;
  - with default rate limits it exhausts the per-IP bucket within about 2 s, shows a stale signed-in shell with "Too many requests", and refuses other sign-ins from that IP.
  - The cause is `LoginPage.tsx` `if (me.data)` on the stale cached `/me`, together with `RequireSession`. It is pre-existing since DG1 `4cd9224` and is exposed by D-073.

## Checks run (Node 22.22.2 and 24.21.0)

| Check | Result |
|---|---|
| typecheck | exit 0 / 0 |
| build | exit 0 / 0 |
| lint | Node 22: exit 0. Node 24 attempt 1: exit 1, caused only by my own `rv/` probe files inside the clone. Node 22 and 24 re-runs: exit 0 / 0. |
| test | 44 files, 796/796, exit 0 / 0 |
| contrast | PASS, exit 0 / 0 |
| live API probes | all PASS after fixing my probe's mistakes (attempt logs kept and explained) |
| UI probes | PASS, except the F-DG2-480 session-end checks (FAIL) |

Every non-zero exit is explained in the review record and in `env.txt`.

## Known gaps

- I did not exercise OIDC/Keycloak sign-in live (residual D-049). `/auth/login` answers 404 in dev mode.
- In the default-limits reproduction, the AR half did not run, because the IP lock-out (part of the finding) blocked the next sign-in.

## Merge instructions

None. These are review records only.
