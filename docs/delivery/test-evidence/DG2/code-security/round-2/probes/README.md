# code-security-reviewer DG2 round-2 probes (T-DG2-REV-SEC-R2)

Disposable clone `$TMPDIR/review-probe` at eb8163e2 (candidate sha256:089a2a2f…, 517 files; HEAD f5a72b4 differs only
by delivery metadata), Node v22.22.2, offline `pnpm install --frozen-lockfile` from a writable copy of the host pnpm
store, `pnpm -r build`. Probe files are copied to `apps/api/test/integration/` in that clone only (never into the
candidate) and run against a disposable PostgreSQL 16 (`../with-pg.sh`, nested user ns, 127.0.0.1:<port>, removed
afterwards). All data SYNTHETIC.

- `zz-sec-r2-probe.test.ts` — verification of F-DG2-140 (R1 paths, owner-edit note/url/file variants, title-launder,
  DB bypass as mth_app incl. spoofed content_authored_by and a pre-reviewed INSERT), F-DG2-141 (R1 repro + targetDate,
  trajectoryPoints, baselineValue, BO-then-TL, post-approval edit; controls), F-DG2-142 (R1 repro + AUD + 404 +
  control), and the new activateKpiDefinition op (WL/BO/AUD 403+audit, 409, 422). 17 tests, PASS in both runs.
- The round-1 probe `../../round-1/probes/zz-sec-r1-probe.test.ts` was re-run VERBATIM in the same invocations
  (probe-run1.log port 55481, probe-run2.log port 55482):
  - SEC-1.note / SEC-1.file now fail with `expected 400 to be 403`. This is a PROBE ARTEFACT of the fix: the attack's
    first step (TL editing / uploading over WL's evidence) is now refused 403, so `edit.body.version` is undefined and
    the follow-up review sends `If-Match: "undefined"` → 400. The defect is closed (no content supplied by TL; the
    r2 probe checks the same paths with corrected assertions, plus the owner-edit variants where editing IS allowed).
  - SEC-2 and SEC-3 now PASS (403). SEC-4 PASS.
  - SEC-5 `owner_delete_evidence_content` COMMITTED in run 2 only: in run 2 the r1 file ran first, and because SEC-1.file's
    upload is now refused, evidence_content was EMPTY; the append-only trigger is FOR EACH ROW so a 0-row DELETE commits
    (same probe-defect class as round-1's charter_version note). Disambiguated by `zz-sec-r2-append-only.test.ts`
    (probe-append-only.log): with a row present, owner DELETE and UPDATE are refused 42501 and the count is unchanged.
