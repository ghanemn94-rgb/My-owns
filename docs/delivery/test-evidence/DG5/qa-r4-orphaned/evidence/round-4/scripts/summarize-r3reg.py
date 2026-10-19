# qa-verifier r4: summarize an R3-REG / R3-TAB result directory (<shots>/<label>/{en,ar}/r3-reg.json, r3-tab.json).
import json, sys, os
d = sys.argv[1]
for lang in ("en", "ar"):
    p = os.path.join(d, lang, "r3-reg.json")
    if not os.path.exists(p): print(lang, "no r3-reg.json"); continue
    rows = json.load(open(p))
    n390 = sum(len(r.get("regions390", [])) for r in rows); n200 = sum(len(r.get("regions200pct", [])) for r in rows)
    print(f"{lang}: {len(rows)} screens; scrolling regions 390={n390} 1366={sum(len(r.get('regions1366', [])) for r in rows)} 200%={n200}")
    for r in rows:
        probs = []
        if r.get("error"): probs.append("error " + r["error"][:120])
        for k in ("axe390", "axe1366", "axe200pct"):
            if r.get(k): probs.append(f"{k} {r[k]}")
        for k in ("overflow390", "overflow200pct"):
            if (r.get(k) or 0) > 1: probs.append(f"{k}={r[k]} culprits={(r.get(k.replace('overflow','culprits')) or [])[:1]}")
        for k in ("regions390", "regions1366", "regions200pct"):
            bad = [x for x in r.get(k, []) if not x["ok"]]
            if bad: probs.append(f"{k} not ok {bad}")
        for k in ("kbd390", "kbd200pct"):
            bad = [x for x in r.get(k, []) if not (x["focused"] and x["scrolled"])]
            if bad: probs.append(f"{k} {bad}")
        if r.get("dupNames390"): probs.append(f"(obs k) duplicate names {r['dupNames390']}")
        if probs: print("  ", r["url"], "|", " ; ".join(probs))
    t = os.path.join(d, lang, "r3-tab.json")
    if os.path.exists(t):
        for o in json.load(open(t)):
            print("   TAB", o["url"], [(x["reached"], x["presses"], x["scrolled"]) for x in o["regions"]])
