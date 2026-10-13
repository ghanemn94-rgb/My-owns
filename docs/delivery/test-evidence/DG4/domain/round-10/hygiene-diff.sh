#!/usr/bin/env bash
# domain-reviewer DG4 round 10: product-hygiene scan of the ADDED lines of the round-10 product diff (f2ae717..e70ac02,
# excluding docs/delivery): no certification / official-PMI / official-Mobily claim, no DG0-DG7 in user-facing text,
# no brand colour change. Expected: no matches in the i18n files.
cd /home/user/My-owns
git diff f2ae7170630456a772e1ceac90ab6d96b68e3f5c..e70ac02f63cd1f42487cfa4dae73f68e933da015 -- apps/web/src/i18n | grep '^+' | grep -v '^+++' > "$TMPDIR/added-i18n.txt"
echo "### added i18n lines: $(wc -l < "$TMPDIR/added-i18n.txt")"
grep -inE 'PMI|certif|official|معتمد رسمي|شهادة|Mobily|موبايلي|#0078FF|\bDG[0-7]\b' "$TMPDIR/added-i18n.txt"; echo "### i18n claim grep exit=$? (1 = none)"
echo "### whole diff, added lines mentioning DG0-DG7 (test comments only expected):"
git diff f2ae7170630456a772e1ceac90ab6d96b68e3f5c..e70ac02f63cd1f42487cfa4dae73f68e933da015 -- . ':!docs/delivery' | grep '^+' | grep -v '^+++' | grep -nE '\bDG[0-7]\b' | cut -c1-200
rm -f "$TMPDIR/added-i18n.txt"
