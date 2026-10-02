# code-security-reviewer DG2 round-1 probes

Disposable clone `$TMPDIR/review-probe` at 311b114 (candidate sha256:8ef26b71…, source 98a8d99), Node v22.22.2,
offline `pnpm install --frozen-lockfile` from a writable copy of the host pnpm store, `pnpm -r build`.
The probe file is copied to `apps/api/test/integration/zz-sec-r1-probe.test.ts` in that clone only (never into the candidate) and run with:

    with-pg.sh <port> npx vitest run --project integration apps/api/test/integration/zz-sec-r1-probe.test.ts

`with-pg.sh` (../with-pg.sh) runs initdb + postgres 16.13 in a nested user namespace (uid 1000), TCP 127.0.0.1:<port>,
trust auth, and removes the cluster afterwards.

- probe-run1.log (port 55460): first run. Its SEC-5 failure (owner UPDATE on charter_version "COMMITTED") was a PROBE
  DEFECT: no charter_version row existed, so the row trigger could not fire.
- probe-run2.log (port 55461): probe fixed (creates a charter first). SEC-5 PASS: every DB guard fires.
  SEC-1 (x2), SEC-2 and SEC-3 FAIL in both runs = reproduced defects. SEC-4 PASS in both runs.

The assertions encode the SECURE expectation; a failing assertion is a reproduced defect. All data is synthetic.
