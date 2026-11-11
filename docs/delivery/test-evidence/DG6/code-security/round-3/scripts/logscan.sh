#!/bin/bash
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-3
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
rm -rf $TMPDIR/scan; mkdir -p $TMPDIR/scan; cp $E/12-integration-*.log $E/13-integration-*.log $E/30-*.log $E/31-*.log $E/32-*.log $E/33-*.log $E/34-*.log $E/35-*.log $TMPDIR/scan/
cd $TMPDIR/rv
{ echo "# $(date -u +%FT%TZ) node deploy/scripts/log-scan.mjs over copies (\$TMPDIR/scan; the scan refuses docs/delivery, D-138) of the four binding integration logs and the assistant probe and mutant logs (30-35)"; ls $TMPDIR/scan; node deploy/scripts/log-scan.mjs $TMPDIR/scan/*.log 2>&1 | tail -5; echo "exit=${PIPESTATUS[0]}"
  echo "--- direct grep of synthetic secret literals from the test sources (lines printed only when found):"
  for v in qa-a17-synthetic-signing-secret-0001 mth-canary-qa-a22-bearer-token-000000000001 mth-canary-qa-a22-csrf-000000000001 mth-canary-qa-a22-oidc-client-secret-0001 mth-canary-qa-a22-s3-secret-key-0001 mth-canary-qa-a22-smtp-password-0001 synthetic-canary-be-x3-model-key-6b0e synthetic-canary-bearer-9c1e synthetic-canary-model-key-73fd synthetic-canary-s3-secret-91c4 synthetic-canary-secret-7f3a91 synthetic-canary-smtp-password-5b21 synthetic-feed-token-be-y2-8a3e synthetic-model-key-be-y2 synthetic-oidc-client-secret-be-y2-41d0 synthetic-orga-erp-token-z2-77c4 synthetic-orgb-erp-token-cs-r2-e3f1 synthetic-prompt-canary-4410 synthetic-signing-secret-be-y2-a synthetic-signing-secret-be-y2-b synthetic-smtp-password-z2; do grep -l -- "$v" $TMPDIR/scan/*.log; done
  echo "--- grep for sk-/AKIA/Bearer/private-key shapes:"; grep -nE 'sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|Bearer [A-Za-z0-9._-]{20,}|BEGIN [A-Z ]*PRIVATE KEY' $TMPDIR/scan/*.log | head; echo end; } > $E/42-log-scan.log 2>&1
rm -rf $TMPDIR/scan
