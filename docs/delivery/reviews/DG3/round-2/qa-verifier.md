# DG3 round 2: qa-verifier narrative

**Verdict: FAIL**, only because of the new finding **F-DG3-180** (Medium, not mandatory).

- **Candidate:** sha256:58ef3f47… (754 files), source f49ca160. Verified on the complete repository, in a disposable clone and at `--ref`, at the start and at the end.
- **Acceptance:** every one of the 32 DG3 acceptance texts still passes literally.

## What I ran (all in a disposable clone, all output in `docs/delivery/test-evidence/DG3/qa/round-2/`)

| Check | Result |
|---|---|
| typecheck, build, lint, openapi:lint (270 ops), no-cdn, format, contrast | all EXIT 0 |
| Formula guard negative probe (KBE-D) | 9/9 forbidden forms refused (EXIT 1 by design); the shipped code is lint-clean |
| Unit, Node 22/24 × locale unset/C.UTF-8 | 4 × 1565/1565 |
| Integration ×2 (fresh PostgreSQL 16 each) | 793/793 twice; 27 migrations; 270 ops live; all p3-pending lists empty; the 2 new annotation tests pass |
| e2e, 13 specs × chromium-en/ar × 2 locale settings | 204/206 each. Product + A20: 172/172, as in round 1. My spec: 16/17 per project. The only failure is F180 |
| Recorded acceptance checks | 163 per project per setting, 0 failed (round 1: 117 + 46 new) |
| axe | product: 1344 analyses per setting, 0 violations; mine: 32 per setting, 0 serious or critical |
| validate --register DG3 / --pipeline / --historical DG2, DG1 | all PASS |

## Repairs re-tested from the acceptance side

**T-DG3-KBE-D (formula guard).** The new rules pass on the shipped code and refuse every forbidden form I tried. The formula acceptance texts (REQ-PB-056/057, REQ-S08-007) give the same literal results as in round 1. F-DG3-100 itself is code-security's to verify.

**T-DG3-ARCH-05 (inheritedApproval).**
- **Through the API, correct in every state:**
  - `null`, `pending_verification`, `accepted` (counts true, and counts false after an evidence edit), `rejected` and `revoked`;
  - the selection rule: counting first, then newest pending, then newest;
  - the list and the view are identical, with exactly the 5 contract keys;
  - the gate stays `draft`, with no submission and no gate decision or submission event in the audit trail;
  - AUD reads the same annotation and gets 403 on every write;
  - an End-to-End transformation is refused 422, and G4 is refused 400.
- **On screen:** the text, the neutral chip, the source line, the link, dir/lang and axe are correct in EN and AR, and AUD sends no writes.
- **The layout is wrong.** The badge is a `.status-chip` with `white-space: nowrap`, so its long text overflows the gate card and the field:
  - EN: 7/7 badges overflow; one reaches x=1449 on the 1280 px viewport;
  - AR: 4/7 overflow;
  - the "(does not approve this gate)" clause ends up under the neighbouring card or over the next column.

  That clause is exactly what the repair is meant to show in every state. My F180 probe measures this. It fails in every project and setting, and is raised as **F-DG3-180**. Axe does not detect overlap.

## Disclosure

All my non-zero exits are explained in `RUN-NOTES.md`: four development trials of my own spec, the by-design lint probe, and F180.

At the very end of the run, `git log` subjects showed that the domain reviewer raised F-DG3-170 for an "inherited-approval badge overflow". I had already measured, written and run F-DG3-180 by then. I did not open that record, so I can't say whether the two are the same. They may be duplicates.

Everything is synthetic. The G1–G4 decisions in my runs are demo business records that approve nothing real, and product gates never imply DG0–DG7.
