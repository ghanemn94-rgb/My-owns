# DG2 round 14 — domain-reviewer narrative

**Verdict: PASS.** No new findings. F-DG2-480 is CLOSED_VERIFIED.

| | |
|---|---|
| Candidate | `sha256:9f3ca298d029f691330de1eddab806df57d5876307926b50df0312f8882b684e` (560 files; recomputed in the repo and in the disposable clone, before and after the runs) |
| Source / freeze | `ea9051b2` / `d99de987` |
| Invocation | `DG2-T-DG2-REV-DOM-R14-domain-reviewer-20261007T100739Z-92b93a49` |

## F-DG2-480 (session end while the app is open)

There is now a single rule. A 401 `unauthenticated` while the session is active moves the client to an "ended" state. `RequireSession` then:

- disables `/me`;
- clears the cache once;
- navigates once to `/login?returnTo=…&error=session_expired`.

`LoginPage` trusts only a `/me` answer that arrived after it mounted.

I tested this live in EN and AR, with five triggers plus the refused upload:

- a real second tab clicks Sign out;
- an administrator revokes the role assignment;
- idle expiry;
- absolute expiry;
- logout by API.

The results were the same with raised limits and with the product's **default** rate limits:

- One navigation to the sign-in page, with the form and the localized message.
- Exactly 1 `/me` request in 10 s and 0 × 429. In round 13 the tab looped at about 130 `/me` per second.
- No stale signed-in shell.
- A second browser context from the same IP signs in.
- Signing in again returns the user to the page they were on.

One limit is inherent and not a defect: a tab can only learn that its session ended from its next server request.

## FE11 / FE12

- **Refused language save.** When the save fails, the chosen language stays and the notice is in that language, in both directions. A successful save clears the notice.
- **Header layout.** The notice sits below the header. At 320, 768 and 1280 px in EN and AR, header height and wordmark width are unchanged and nothing overflows.
- **Translation at render time.** These follow a language switch while they are visible: the dev-login errors, the Team "Role assigned" notice and the journey-steps errors.
  - The header switch is inert behind the modal steps editor. That is expected modal behaviour, so the probe dispatched the click instead.

## Full re-review of the 26 requirements

- **Static source fidelity: 24/24.** Checked against B0009, B0018, B0023, B0029, B0035, B0037, B0039–B0043, B0056 and B0062.
- **Live API: all probes pass.** Live scenario 101/101, design registers 11/11, and the earlier regression probes.
- **UI walk in EN and AR: passes.** It covers the Arabic RLM charter text stored verbatim, the invisible-only value refused with the localized message, and an evidence upload that downloads unchanged.
- **Gates.** G1→G2→G3 are strictly sequential (out of order → 422) and carry the B0023 names. The submitter cannot decide. G2 is blocked with zero guardrails.
- **Invariants intact:**
  - provisional brand;
  - no PMI or Mobily certification claim;
  - decimals, with no float columns;
  - unquantified pools are labelled, with a null amount (not 0);
  - product gates are G1–G6 only and separate from DG0–DG7.
- **Checks on Node 22 and 24.** Typecheck, build, lint, test (848/848) and contrast all pass.

## Evidence honesty

All non-zero exits and attempt logs are explained in `env.txt` and in each check's `actual`. Every one of them was a mistake in my own probes:

- a cached page made no request;
- an expiry step also expired my probe's own API session;
- a preference was left over from an earlier probe;
- my sign-in volume exceeded the 20/min auth budget;
- the stack teardown trap failed after the shutdown probe.

All data is synthetic. The demo G1–G3 decisions approve nothing real.
