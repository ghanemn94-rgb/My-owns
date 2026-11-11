#!/bin/bash
# release-auditor T-DG6-AUDIT-RG-R4: product gates G1-G6 vs engineering gates DG0-DG7, certification/official claims,
# the provisional brand token and wordmark, and the synthetic demo labels. git grep at the source commit, run inside the
# audit clone ($1). Lines are cut at 240 bytes (a cut can split a multibyte Arabic character at the line end).
S=f56f1b3d24c00d1803f6627c99b3f422a47b3014
cd "$1" || exit 2
strip() { sed "s/^$S://" | cut -c1-240; }
echo "# $(date -u +%FT%TZ) git grep at $S in the audit clone (HEAD $(git rev-parse --short=9 HEAD))"
P="apps packages deploy docs/architecture docs/api e2e tests README.md"
echo "--- (1) certification / official-PMI / official-Mobily claims (case-insensitive; every hit printed; each must be a prohibition, a disclaimer, a negated mention or a test fixture of the refusal):"
git grep -n -i -E "pmi[- ]certified|certified by pmi|official pmi|pmi standard|pmi-approved|officially (certified|approved)|official mobily (brand|colou?r|logo)" $S -- $P | strip
echo "(1) hit count: $(git grep -n -i -E 'pmi[- ]certified|certified by pmi|official pmi|pmi standard|pmi-approved|officially (certified|approved)|official mobily (brand|colou?r|logo)' $S -- $P | wc -l)"
echo "--- (2) DG0-DG7 named as a word, NOT as part of a finding/task id (F-DGx-, T-DGx-):"
echo "(2a) en/ar UI strings:"
git grep -n -P "(?<![FT]-)\bDG[0-7]\b" $S -- apps/web/src/i18n | strip
echo "(2a) count: $(git grep -n -P '(?<![FT]-)\bDG[0-7]\b' $S -- apps/web/src/i18n | wc -l)"
echo "(2b) non-test product source, non-comment lines:"
git grep -n -P "(?<![FT]-)\bDG[0-7]\b" $S -- 'apps/*/src/**' 'packages/*/src/**' ':!*.test.ts' ':!*.test.tsx' | strip | grep -v -P '^[^:]+:\d+:\s*(//|\*|/\*)'
echo "(2b) end"
echo "(2c) migrations, non-comment lines:"
git grep -n -P "(?<![FT]-)\bDG[0-7]\b" $S -- packages/db/migrations | strip | grep -v -P '^[^:]+:\d+:\s*--'
echo "(2c) end"
echo "--- (3) statements that the two gate systems are separate and G6 never implies DG7 (ADRs):"
git grep -n -i -E "G6.{0,80}(never|does not).{0,40}DG7|share nothing|Two gate systems" $S -- docs/architecture/adr | strip | head -12
echo "--- (4) #0078FF and the provisional token source:"
git grep -n "\$comment" $S -- packages/design-tokens/src/tokens.json | strip
git grep -n -i "0078FF" $S -- apps/web/src/pages/branding apps/web/src/i18n/en/common.json | strip | head -6
echo "--- (5) provisional text wordmark:"
git grep -n -i -E "provisional" $S -- apps/web/src/components/Wordmark.tsx apps/web/src/i18n/en/common.json | strip | head -6
echo "--- (6) demo data synthetic and labelled (ADR-0050 §2 and the en strings):"
git grep -n -i -E "synthetic" $S -- 'docs/architecture/adr/ADR-0050*' | strip | sed -n '1,12p'
git grep -n -i -E '"[A-Za-z]*": "[^"]*(Illustrative example|synthetic)[^"]*"' $S -- apps/web/src/i18n/en | strip | head -10
echo "--- (7) no engineering agent or assistant grants a business approval (ADR statements):"
git grep -n -i -E "grants? no (real )?(business|Finance|IT)|approves nothing real|never (approves|grants)" $S -- docs/architecture/adr | strip | head -10
echo "end"
