# DG7 round 6: qa-verifier narrative

- **Task:** T-DG7-REV-QA-R6
- **Session:** ed63881a-044f-470f-bd1b-844794bf91c7
- **Candidate:** `sha256:0b48162701518d1fb47789282112f2d5528429e77d6f108d3f8696570f06bc95` (source `830d7edf`, 3157 files). I verified it at the start and the end, and in a clone.
- **Verdict: PASS.**
  - F-DG7-971 is verified closed.
  - One new Low finding, F-DG7-972. It is not mandatory and not blocking.

## F-DG7-971: verified closed

**Real drills.** I ran eight transfer drills on archives built from the frozen clone. All eight pass D0–D11, including the real restart and job-check.

- Seven D9 rechecks were `matched`. Two of these had 14:00 or 13:00 near or inside the window, but the starter had not yet written an execution when the recheck read the target.
- One run (run3/b) crossed 14:00 with a real `approval.escalation_scan` execution:
  - window 13:59:45.715–14:00:33.441Z on T's clock;
  - the recheck exited 4 with exactly the round-5 pattern;
  - the execution `01a1e4a8-d634-…` (key `…:2026-11-16T14:00`, slot 14:00Z, `*/15` Asia/Riyadh, one result, three audit events) was explained and listed;
  - `reconcile-d9.json` kept the real exit 4;
  - the worker's outcome was `selected 0, escalated 0`.
- The A18 harness passed 10/10. Its own re-check accepts the live entry and rejects eight tampered copies.

**Trying to make the rule explain what it must not.** On the kept run3/b target I ran the shipped CLI unchanged, with one committed mutation at a time. Each of these FAILs with the exact A5.4 reason:

- an initiating user;
- an event trigger with a schedule-format key;
- a disabled schedule;
- a real slot 15 minutes before the window;
- a key two minutes late;
- `created_at` before W0;
- a second, unlisted execution for the same slot;
- the worker event re-attributed to a user;
- the id already in the package.

An unrelated changed table, or an `unexplained changed` key, makes Gate 0 not applicable. The restored target passes again. The `job_schedule` and `pgboss.schedule` digests never change, so the stage is read only.

**Probes and mutants.**

- 45 pure-function probes of my own behave as expected, including the exact window boundaries.
- 12 single-condition mutants of the rule are all killed by DO-D9's own tests.
- The deploy suite passes 204/204, including T-S9 on PostgreSQL.

**Soundness.** The decision is exactly D-278:

- mode 2 is unchanged;
- nothing is paused or rescheduled;
- the residuals (a handler's own business writes, engine ticks, pg-boss timing) fail strict.

## F-DG7-972 (new, Low): A5.6 disclosure surfaces

ADR-0064 Amendment 5 A5.6 puts the D-278 disclosure in three places: `known-limitations.md`, the release notes and `deployment.md`.

- `deployment.md` and the register notes carry it.
- `known-limitations.md`, the release notes and both Arabic summaries do not.
- AN-P7H asked the orchestrator about this, and D-279 does not answer it.

There is no behavioural effect: an operator running the drill from `deployment.md` gets the rule and the recovery. It can be repaired or accepted as an observation.

## The whole candidate

| Check | Result |
| --- | --- |
| Static (build, typecheck, lint, OpenAPI lint, no-CDN, format) | exit 0 |
| Unit | 3036 tests pass; one file re-run after my sparse clone lacked its committed input: 6/6 |
| Integration | 475/475 files, 4696 passed, 8 explained skips, 1 carried todo |
| Tool suites | gates 66, agents 39, migration 29, deploy 204 |
| Release and licences | 458 + 2 explained skips; the 6 T-H4 failures were my sparse clone's missing report; re-run 51/51 |
| Release-tool checks, payload and history secret scans, claims scan | all exit 0 |
| Product e2e | en 286 and ar 286 (each with one explained skip); demo keyboard 2 |
| Root acceptance | 288 passed, 18 'NOT SCANNED' axe routes; connection log loopback only |
| Offline drill | 10/10, 303 loopback connections |
| A19 | drill PASS, plus the 13-test harness |
| Register | 412 rows IMPLEMENTED, 54 DG7 rows; notes of 3 rows changed |
| Protocol audit | equal to r6 (281 hits; C3 = 7) |
| Dependencies | 69 pinned |
| K11 | the next action matches |

Container half (D-267): there is no server-surface change since host run 3, so the host evidence applies. I could not run Docker myself and do not mark it as re-run.

## Honesty notes

- **Orphaned driver.** A `pkill` I ran killed its own shell. The attempt-1 driver kept running unseen in another sandbox namespace and later removed a shared scratch path. Its later outputs are correct refusals on missing or replaced inputs, not product results. Attempts 2–4 were isolated.
- **Draft probe defect.** My first probe draft had a defect (G11). I corrected it and kept the draft log.
- **Round number.** The assignment's `round: 7` contradicts the round-6 path and the validator, so this record uses 6. The DG5/round-6 template it names does not exist.
- **Independence.** I did not read any other reviewer's round-6 record.
- **Approvals.** Nothing here grants or implies a G1–G6, Finance, IT or DG approval. Product gate G6 never implies DG7.
