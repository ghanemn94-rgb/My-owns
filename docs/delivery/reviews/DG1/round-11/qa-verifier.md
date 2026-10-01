# DG1 round 11 — qa-verifier narrative

- **Candidate:** `sha256:e5cc6ef982ba7d53ed80138c0cbaa0119bcfe8dcaad4e324b5dafdb6431afeb8`, freeze commit `32e6478`, 391 files. Recomputed identically in the repo (HEAD d8eb695, later 4caa00b; both commits after the freeze add only metadata and other reviewers' records) and in a full disposable clone.
- **Verdict:** **PASS**. No new findings.
- **Invocation:** run `DG1-T-DG1-REV-QA-R11-qa-verifier-20261001T151913Z-387e17fe`, session `387e17fe-9331-4641-949b-1e3ed79db865`.

## What changed since round 10 (verified from the manifests, not the summary)
The candidate source changes are limited to:
- `apps/web/test/jsdom-native-abort-environment.ts` (new);
- `apps/web/vitest.config.ts` and `apps/web/tsconfig.json`;
- `apps/api/src/architecture.test.ts` and `apps/api/src/architecture.testkit.ts`;
- `docs/delivery/decisions.md`.

No product runtime file changed.

## Findings verified
| Finding | Result | Key evidence |
|---|---|---|
| F-DG1-214 (Medium) | **CLOSED_VERIFIED** | Node 24: 302/302, unit-web 110/110, 0 AbortSignal errors. Node 22: the same. Negative control: built-in jsdom on Node 24 gives 12/110 failures, the exact round-10 error, so the harness is causal. |
| F-DG1-215 (Low, ≡132) | **CLOSED_VERIFIED** | The residual (a) statement now covers namespace enumeration; the wording says "every SPELLED form". The self-check pins E1–E4 and still bans S1–S3. My independent probe flags 20 spelled forms. |
| F-DG1-009 (re-confirm) | holds | 3 integration runs (2× Node 22, 1× Node 24): 200/200 each, no 57P01, 0 terminated connections in the server logs. |
| F-DG1-210 (re-confirm) | holds | e2e 22/22 on Node 22 and on Node 24 (EN+AR). The independent QA spec passes 2/2 with `documentLoads=0`. |

F-DG1-132 (code-security) is the same route as F-DG1-215. I leave its closure to its reporter. F-DG1-011 is not in my assignment.

## Checks (all real output; logs in `docs/delivery/test-evidence/DG1/qa/round-11/`)

**Build and static (Node 22):** all exit 0.
- build, typecheck, lint;
- OpenAPI: 33 operations;
- no-CDN, Prettier;
- contrast: 50 AA pairs.

**Unit:** 302/302 on both Node 22 and Node 24 (unit-node 192 + unit-web 110).

**Integration:** 3 runs, 200/200 each, on a disposable PG 16.13. These include:
- A12 (14/14), A13 (5/5), A14 (5/5);
- the contract suite (9/9, including getBrandingTokens);
- the audit trigger: UPDATE, DELETE and TRUNCATE are rejected, and the row count is unchanged.

**e2e:** 22/22 on each runtime. axe finds 0 serious or critical violations on 15 EN and 15 AR screens.

**Acceptance and register:**
- A18 clean start: PASS, with a real offline frozen install.
- A20 token propagation: PASS.
- The REQ-DLV-042 installer log is unchanged: 14 PASS, 0 FAIL.
- Validators: `--register DG1`, `--pipeline` and `--reconcile` all PASS.
- All 12 requirements are DG1/IMPLEMENTED with 0 missing evidence files.

## Disclosures
- **Probe attempt 1:** my round-11 setEngine probe first expected the extra form X1 (`Object.getOwnPropertyDescriptors`) to be unflagged. The lint flags it as reflection, which is stricter than the residual and safe. That was my expectation error, not a candidate defect. I corrected the probe and re-ran it in a fresh clone: 31/31 on both runtimes. The attempt-1 logs are kept (`08-*.attempt1.log`).
- **`pnpm deps:verify` was not run to completion:** it calls `npm view`, and this sandbox has no network. I stopped it. It is not part of the round-11 QA assignment, and REQ-S16-009 is not among the 12 requirements, so it is not listed as a check and not claimed as PASS (`02-deps_verify.log`).
- **PostgreSQL version:** the local disposable PostgreSQL is 16.13, while CI pins postgres:18 by digest. PG 18 was not exercised here. This is the same environment limit as in earlier rounds.
- **Independence:** I did not open the domain-reviewer or code-security-reviewer round-11 records that were auto-committed during my run (file names only, `00b-head-moved.log`).
- **No real approvals:** this engineering review grants no business, Finance or IT approval. Product gate G6 is unrelated to DG gates.
