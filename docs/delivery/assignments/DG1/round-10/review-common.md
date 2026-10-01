# DG1 round-10 review — common instructions
You are independently re-reviewing the DG1 candidate after the round-9 all-PASS, which raised two Low, non-mandatory findings. Both are now fixed. Read your role file next.

## Candidate (all three reviewers + auditor)
- **candidate_id:** `sha256:18fee1617d617cfd719aeaebe3c37904bd116c47eaafb5be52e7bd779c6e8807`
- **source_commit:** `265af7e65a6a66f1dabcc678d9bf1adb1415f601` is the freeze commit (candidate-excluded metadata only); the recomputed id is identical — verify `node tools/gates/candidate.mjs --stage DG1`. Complete clone (not shallow).
- **manifest:** `docs/delivery/candidates/DG1/18fee1617d617cfd.manifest.json`.

## What changed since round 9 (both findings now `FIXED_PENDING_VERIFICATION`)
- **F-DG1-130 (Low, REQ-S16-003):** the round-9 default-deny allow-lists guard which built-in MODULES a module may import, not the MEMBERS of an allowed module. `crypto.setEngine(<path>)` `dlopen()`s a shared object even though `node:crypto` is allow-listed. Fix: `setEngine` is added to rule-1 `BANNED_PRIMITIVES` ("native loader"), so `crypto.setEngine` is a violation in every form (named/namespace/string-key), while importing `node:crypto` and using `randomUUID`/`createHash` stays allowed. An **exhaustive member-audit** of the seven allow-listed built-ins (`crypto, fs, fs/promises, os, path, url, util`) is recorded in the testkit header: `crypto.setEngine` is the only native/loader/exec member; `os.loadavg`, `fs.open*`, `util.*`, `crypto.setFips` are cleared; `node:fs` write-then-`import()` remains residual (b).
- **F-DG1-131 (Low, REQ-DLV-042-ish/REQ-S16-003):** D-055's wording that the allow-lists "equal real usage / minimal set" is corrected — module source imports 4 of the 7 built-ins (`crypto/fs/path/url`) and uses none of the 4 process members; the rest is **reviewed safe headroom**, each confirmed to carry no loader/exec/native/debug capability.

These were the only open findings; no other candidate change. D-055 records both (and supersedes D-053/D-054).

## Your job
Verify the finding(s) you own (your role file lists them); re-run your checks (real output; a missing tool/DB is BLOCKED); re-check the 12 DG1-final requirements; confirm no regression. You did not implement these repairs. Write `docs/delivery/reviews/DG1/round-10/<role>.json` + sidecars; evidence under `docs/delivery/test-evidence/DG1/<key>/round-10/`. PASS only if the fixes verify, every assigned requirement is complete with existing evidence, and no unresolved Critical/High/mandatory remains. Note: default-deny means probing "another import/process route" finds it already denied; if you probe a MEMBER of an allow-listed built-in, check it against the header's recorded member-audit before raising it (a member the audit already cleared as non-loading, or already banned, is not a new finding; a genuinely new native/loader member the audit missed IS worth raising).
