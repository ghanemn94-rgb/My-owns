#!/usr/bin/env bash
# code-security-reviewer, DG7 round 2 (T-DG7-REV-CS-RG2): verification of F-DG7-1011 on candidate 33266ccd and probes
# of the S3 exemptions that remain after the repair.
# Usage: s3-secret-shapes-rg2.sh <candidate-clone-root>
# Every value is generated at run time under $TMPDIR (openssl); nothing secret-shaped is committed.
# Cases a-d are the round-1 cases (must now be: a, b, c, d reported S3, exit 1).
# Cases e-h probe the remaining exemptions (observations, see the review record):
#   e  secret_access_key = <openssl rand -hex 32>   (docs/operations/storage.md l.187 shape; 64-hex checksum exemption, disclosed in SC-13)
#   f  OIDC_CLIENT_SECRET = <24 upper-case hex starting with a letter> ("key NAME" exemption [A-Z][A-Z0-9_]+)
#   g  api_token = <32 base32 upper-case>            ("key NAME" exemption)
#   h  POSTGRES_PASSWORD = <four 6-letter lower-case words joined by _> (i18n-key shape; a passphrase)
#   i  i18n control: password_hint = auth.password.reset_hint_text (must stay exempt)
set -u
REPO="$1"
W="$(mktemp -d "${TMPDIR:?}/s3repro.XXXXXX")"
HEX24="$(openssl rand -hex 24)"
HEX16="$(openssl rand -hex 16)"
LOWER="$(openssl rand -base64 48 | tr -dc 'a-z0-9' | head -c 24)"
MIXED="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 24)"
HEX32="$(openssl rand -hex 32)"
UPHEX="F$(openssl rand -hex 12 | tr 'a-f' 'A-F' | head -c 23)"
B32="$(openssl rand -base64 64 | tr -dc 'A-Z2-7' | head -c 32)"
B32="J${B32:1}"
WORDS="$(openssl rand -base64 64 | tr -dc 'a-z' | head -c 24 | sed -E 's/(.{6})(.{6})(.{6})(.{6})/\1_\2_\3_\4/')"
mkdir -p "$W"/{a,b,c,d,e,f,g,h,i}
printf 'services:\n  db:\n    environment:\n      POSTGRES_PASSWORD: %s\n' "$HEX24" > "$W/a/compose.override.yaml"
printf 'storage:\n  s3_access_key: %s\n' "$HEX16" > "$W/b/values.yaml"
printf 'OIDC_CLIENT_SECRET="%s"\n' "$LOWER" > "$W/c/deploy.conf"
printf 'OIDC_CLIENT_SECRET="%s"\n' "$MIXED" > "$W/d/deploy.conf"
printf 'storage:\n  secret_access_key: %s\n' "$HEX32" > "$W/e/values.yaml"
printf 'OIDC_CLIENT_SECRET="%s"\n' "$UPHEX" > "$W/f/deploy.conf"
printf 'api_token: %s\n' "$B32" > "$W/g/values.yaml"
printf 'POSTGRES_PASSWORD: %s\n' "$WORDS" > "$W/h/values.yaml"
printf '{ "password_hint": "auth.password.reset_hint_text" }\n' > "$W/i/strings.json"
for case in a b c d e f g h i; do
  echo "--- case $case: $(sed -E 's/(: |=")[^"]*"?$/\1<value>/' "$W/$case"/* | tail -1)"
  node "$REPO/tools/release/secret-scan.mjs" --path "$W/$case"
  echo "exit=$?"
done
echo "--- isI18nKey / isNonSecretValue / entropy on the same values (exempt=true means not reported):"
node --input-type=module -e "
import { isNonSecretValue, isI18nKey, entropy } from '$REPO/tools/release/secret-scan.mjs';
for (const [k, v, label] of [['POSTGRES_PASSWORD', '$HEX24', 'a hex24'], ['s3_access_key', '$HEX16', 'b hex16'],
  ['OIDC_CLIENT_SECRET', '$LOWER', 'c lower24'], ['OIDC_CLIENT_SECRET', '$MIXED', 'd mixed24'],
  ['secret_access_key', '$HEX32', 'e hex64'], ['OIDC_CLIENT_SECRET', '$UPHEX', 'f upperhex24'],
  ['api_token', '$B32', 'g base32'], ['POSTGRES_PASSWORD', '$WORDS', 'h words'],
  ['password_hint', 'auth.password.reset_hint_text', 'i i18n']])
  console.log(label, 'length', v.length, 'entropy', entropy(v).toFixed(2), 'i18n', isI18nKey(v), 'exempt', isNonSecretValue(k, v));
"
rm -rf "$W"
