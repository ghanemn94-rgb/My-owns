#!/usr/bin/env python3
# qa-verifier DG6 round 10: mutants applied ONLY in the disposable mutant clone $TMPDIR/c2 (never the candidate).
#   M1 (reverts D-231 / BE-Z14 on the server): a token of another row version is resolved by position instead of refused.
#   M2 (re-introduces F-DG6-560): the i-th restricted token sent is paired with the i-th stored uuid literal (ordinal
#      pairing), not with the literal at the token's own position k.
#   W1 (reverts BE-Z14 in the editor): the form is not reloaded after a save (keeps its pre-save draft and If-Match).
#   L1 (reverts F-DG6-561): the label always shows the total description.
# usage: mutants.py <clone> <M1|M2|W1|L1>
import sys
root, m = sys.argv[1], sys.argv[2]
def sub(path, old, new):
    p = f"{root}/{path}"; s = open(p, encoding="utf8").read()
    assert s.count(old) == 1, (path, old[:60], s.count(old))
    open(p, "w", encoding="utf8").write(s.replace(old, new)); print(f"{m}: patched {path}")
V = "apps/api/src/modules/automation/versions.ts"
if m == "M1":
    sub(V, "    if (Number(m[1]) !== stored.version) throw automationRefusals.restrictedTokenStale(at);\n", "")
elif m == "M2":
    sub(V, "  const merged = mapLiterals(conditions, (v, at) => {",
        "  let ord = 0;\n  const ordered = [...positions.values()].filter((l) => /^[0-9a-f]{8}-/.test(l));\n  const merged = mapLiterals(conditions, (v, at) => {")
    sub(V, "    const literal = positions.get(Number(m[2]));", "    const literal = ordered[ord++];")
elif m == "W1":
    sub("apps/web/src/pages/automation/RulePage.tsx",
        "            if (saved !== null) setForm({ from: saved.version, draft: loadDraft(saved) });",
        "            void saved;")
elif m == "L1":
    sub("apps/web/src/components/sensitivity/RestrictedRecordsLabel.tsx",
        'const hint = scope === "item" ? t("adminP6.restricted.hintItem") : t("adminP6.restricted.hint");',
        'const hint = t("adminP6.restricted.hint");')
else:
    sys.exit(f"unknown mutant {m}")
