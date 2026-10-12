#!/usr/bin/env bash
# qa-verifier DG4 round 7 (F-DG4-147 verification), in the disposable copy $TMPDIR/rv3.
# Part A (deterministic): variants of 'a 403 is not a session end' with the app's boot GET /me of /about forwarded late
# by page.route (DELAY ms), so the re-login happens before that /me is answered unless the test waits for it:
#   old-<DELAY>   = the spec as of round 6 (1e0dc5d) + the delay line   -> expected to FAIL (403 expected, 200 received)
#   fixed-<DELAY> = the candidate spec (dab4562)    + the delay line    -> expected to PASS
# Part B (contention): the candidate spec's test, unmodified, --repeat-each=10 in both projects under the live load.
set -u
C=$TMPDIR/rv3; E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-7; S=$E/scripts
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
cd "$C"
ANCHOR='  await signIn(page, lang, "dev.lead");
  // F-DG4-147'
mk() { # name source-file delay
  python3 - "$2" "apps/web/e2e/zz-qa-r7-147-$1.spec.ts" "$3" <<'PY'
import sys; src,dst,delay=sys.argv[1:]; s=open(src).read()
start=s.index('test("a 403 is not a session end')
a='  await signIn(page, lang, "dev.lead");\n'
i=s.index(a,start)+len(a)
line=(f'  await page.route("**/api/v1/me", async (route) => {{ if (route.request().method() === "GET") await new Promise((r) => setTimeout(r, {delay})); await route.continue(); }}, {{ times: 1 }}); // qa-r7 F-DG4-147 probe: the next GET /me (the boot /me of /about) is forwarded {delay} ms late\n')
s=s[:i]+line+s[i:]
s=s.replace('from "./', 'from "./')  # same directory: imports unchanged
open(dst,"w").write(s)
PY
}
git -C $TMPDIR/rv show 1e0dc5d:apps/web/e2e/session-end.spec.ts > $TMPDIR/session-end.old.spec.ts
for d in 1500 4000; do mk old-$d $TMPDIR/session-end.old.spec.ts $d; mk fixed-$d apps/web/e2e/session-end.spec.ts $d; done
ls apps/web/e2e/zz-qa-r7-147-*.spec.ts | while read f; do echo "$f sha256 $(sha256sum $f | cut -c1-16)"; done > $E/04b-147-variants.txt
diff <(git -C $TMPDIR/rv show dab4562:apps/web/e2e/session-end.spec.ts) apps/web/e2e/zz-qa-r7-147-fixed-4000.spec.ts >> $E/04b-147-variants.txt
CLONE=$C bash $S/run-e2e.sh unset 26640 26645 147-delayed-boot-me apps/web/e2e/zz-qa-r7-147-old-1500.spec.ts apps/web/e2e/zz-qa-r7-147-fixed-1500.spec.ts apps/web/e2e/zz-qa-r7-147-old-4000.spec.ts apps/web/e2e/zz-qa-r7-147-fixed-4000.spec.ts --grep "a 403 is not a session end" --repeat-each=3
rm -f apps/web/e2e/zz-qa-r7-147-*.spec.ts; ls apps/web/e2e/zz-* 2>/dev/null || echo "variants removed from the copy" >> $E/04b-147-variants.txt
CLONE=$C bash $S/run-e2e.sh unset 26650 26655 147-contention apps/web/e2e/session-end.spec.ts --grep "a 403 is not a session end" --repeat-each=10
echo PROBE-147-DONE
