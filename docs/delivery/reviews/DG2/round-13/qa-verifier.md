# DG2 round 13: qa-verifier narrative (T-DG2-REV-QA-R13)

**Verdict: PASS.** F-DG2-460 is closed (CLOSED_VERIFIED). I raised no new findings.

- **Candidate:** `sha256:6824b8b8…3afc`, 556 files.
- **Source:** aa0a68f1, freeze commit 5699f72. The freeze commit changes only orchestrator records, so the candidate ID is identical at both commits.
- **Where I ran things:** three disposable clones, all removed at the end.
- **Machine-readable record:** `qa-verifier.json`, with the sidecar `qa-verifier.verifications.json`.

## F-DG2-460 (Medium): CLOSED_VERIFIED

The fix is BE18A 8c0083e (D-073). Graceful shutdown now waits, bounded, for in-flight handlers to settle before `db.destroy()` and `process.exit`. The filesystem evidence store also sweeps stale `.part` temporaries at start-up.

**My round-12 reproductions now pass.** R12-07 and R11-02 each passed 4 of 4 runs (en and ar × both locale settings), where they had failed 4 of 4 in round 12. After SIGTERM:
- the store is empty;
- the process exits 0 in about 5.03 s;
- there are no content rows.

**New R13-01: uploads actively streaming at SIGTERM.** Two uploads keep sending through the whole 5 s grace (about 6.8 MB of 24 MiB sent) and a third is stalled.
- Exit 0 in about 5.03 s, inside the 10 s backstop.
- No settle-period warning and no error-level log line.
- No `.part` and no final object, after exit or after a restart.

**New R13-02: an upload that finishes inside the grace still commits.** It returns 200 and is stored byte-exact. Exit 0.

**New R13-03: the start-up sweep.** Only the stale (2-hour-old) `<uuid>.part` at the key depth is removed. The removal is logged at info level with the root-relative key, size and age. Everything else is kept:
- a fresh `.part` and a 50-minute-old `.part`;
- old final objects, including a real committed object back-dated by 2 h, which is still downloadable byte-exact;
- look-alikes (`notes.part`, an upper-case UUID);
- `.part` files at the wrong depth, and a `.part` directory;
- stale files that can only be reached through symbolic links.

No other object's bytes changed.

**Negative control.** The same R13-01 and R13-03 on the pre-fix round-12 freeze 744af0b fail, as designed:
- `.part` files of 6.78 MB and 1 MiB remain after SIGTERM;
- no sweep runs.

So the probes do detect the defect.

## D-073 regression (my own negative checks)

**Commit-time authorisation (R13-04).** These pass in en and ar under both locale settings:
- **Positive control:** a team member's upload returns 200 and is stored byte-exact.
- **Grant revoked through `POST /role-assignments/{id}/revoke` mid-upload:** 401, and nothing is stored. The product's revoke also ends the member's sessions, so at commit time there is no session. This is consistent with "takes effect for the next request".
- **Grant that expires mid-upload (`effectiveTo`) with the session still valid:** 403, audited as `authorization.denied`. Nothing is stored and the session still works afterwards.
- **Logout mid-upload:** 401 and nothing is stored. The user's other session is unaffected.

**Login with a never-answering IdP (R13-05).** 25 concurrent `/auth/login` requests against an IdP that never answers, with `AUTH_MODE=oidc`:
- no session is idle in a transaction;
- `/readyz` and a signed-in `/me` answer in under 40 ms;
- the logins end in a 302 `idp_unavailable` redirect, with no 5xx;
- SIGTERM exits 0.

**Other regression checks.** These all pass:
- binary uploads, stored byte-exact with matching sha256 (R12-04);
- Arabic and emoji text, which round-trips verbatim (R12-05, R11-04/05);
- form errors, each still shown once (R8-05, R9-05a–e).

## Everything else

All of these passed:
- **Static checks:** typecheck, build, lint, OpenAPI (161 operations), no-CDN, formatting and contrast all exit 0.
- **Unit:** 7 of 7 runs at 796/796 (Node 22 ×3, Node 24 ×3 and one run under load). No warnings.
- **Integration:** 6 of 6 runs at 652/652. Migrations 0001–0019, guards, the contract (161 operations), blank-text, encoding, invalid-character, framework-errors, invalid-utf8, media-types, evidence, shutdown-cleanup and commit-time-auth were all present, with 0 failures.
- **Product e2e:** 64/64 per locale setting, including Define→G2 and Design→G3 in EN and AR.
- **QA-stack e2e:** 142/142 per locale setting, with UTF8/C `server_encoding`.
- **Accessibility:** 636 axe scans with 0 violations of any impact.
- **Validators:** register, pipeline and reconcile all pass.

**Explained non-zero exits:**
- My first development run of the round-13 spec (`18-r13-spec-dev-run1.log`, exit 1) failed because of two test-authoring mistakes. My snapshot followed symlinks, and I expected 403 for an API revoke that ends the session. Both are corrected; neither was a product defect.
- The negative control exits 1 by design (see above).
- `deps:verify` exits 124 because it cannot reach the registry without a network. That is the D-057 residual.

**Environmental residuals.** D-057 (live registry), D-058 (live CI) and D-049 (Keycloak) pass on the offline/config surface. The residuals themselves remain.

All data is synthetic. No business approval is implied: product gates G1–G6 are separate from engineering gates DG0–DG7.
