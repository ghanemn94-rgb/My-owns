# DG1 round 11: domain-reviewer narrative

- **Candidate:** `sha256:e5cc6ef982ba7d53ed80138c0cbaa0119bcfe8dcaad4e324b5dafdb6431afeb8` (391 files), freeze commit `32e6478`, HEAD `d8eb695` (only excluded metadata differs).
- **Run:** `DG1-T-DG1-REV-DOM-R11-domain-reviewer-20261001T151913Z-8e429fc0`.
- **Verdict:** **PASS**, with no new finding.

## F-DG1-011 (my round-10 finding): verified closed

D-055 now describes its evidence accurately:

- **Overclaims removed.** The "closes the whole … class" and "prevents further adjacent-route findings" phrases are gone.
- **Default-deny claim narrowed.** It is limited to module imports and `process` members. It explicitly excludes allow-listed-module members (F-DG1-130) and their enumeration reach (residual (a), F-DG1-132/215).
- **Runtimes named.** The audit runtime (Node 22.22.2) and the Node 24.21.0 re-audit are both named, and the cited log is committed.

I re-checked each claim myself on **both** runtimes:

- **Member scan.** `crypto.setEngine` is the only loader member. The one new Node 24 match, `util.convertProcessSignalToExitCode`, is benign.
- **Process-member forms.** I probed seven forms, including alias, destructuring and `Object.entries(process)`. All are flagged, and the allowed controls stay clean.
- **Architecture suite.** 109/109 on both runtimes.

The F-DG1-010/011 pattern of a version-detached claim is not repeated.

**Observation (not a finding):** the Rationale/evidence column still quotes the round-9 counts (101/101, 294/294). These are decision-time evidence, and the finding listed refreshing them as optional.

## No regression

The product-tree diff 265af7e..32e6478 touches only:

- the web test harness (custom jsdom environment, vitest config, tsconfig include);
- comments and self-checks in the test-only lint;
- the D-055 text.

There is no change to packages, modules, web src, the contract, i18n or the db.

| Check | Node 22.22.2 | Node 24.21.0 |
|---|---|---|
| Unit suite | 302/302 | 302/302 (web 110/110) |
| Architecture suite | 109/109 | 109/109 |
| Integration (fresh PostgreSQL 16 each run) | 200/200 | 200/200 |

- **Integration cleanup:** no leftover databases and no 57P01 lines on either run.
- **Harness negative control (Node 24):** with the built-in `jsdom` environment, the 12 "Expected signal … AbortSignal" failures reappear. So the harness file is what fixes F-DG1-214, and no product change was involved. F-DG1-214 itself is qa's finding to verify.
- **Live stack (Node 24, synthetic users, AR and EN):** 108/108. Closure is refused with 422 citing G6, and nothing is written. BU-scoped Lead creator. Provisional `#0078FF` tokens. Six-sort cursor pagination, with tamper and binding refusals. Identity routes.
- **Screens.** I inspected them visually. Arabic is RTL and English LTR. The wordmark is marked provisional. Unknown (not zero or green) is shown for missing data. Unbuilt modules are labelled Planned. No Closed option is offered, and the G6 hint is shown.

## Invariants, register and prior closures

- **Static checks.** no-CDN, OpenAPI lint (33 operations), typecheck, eslint and prettier are all clean. Every i18n mention of "official" is a negation.
- **Register.** It is unchanged. All 12 DG1-final rows are IMPLEMENTED with no missing evidence. The 29 P1-increment rows with later gates are SPECIFIED, so none is over-claimed. No Critical, High or mandatory finding is open.
- **Prior closures.** The round-9/10 domain closures (F-DG1-001/002/003/004/005/006/105/007/008/207/009/210/131) hold.
- **G6 wording.** It matches playbook G6 Sustain and B0014. It is stated as a product gate separate from DG0-DG7.

I grant no business, Finance or IT approval.
