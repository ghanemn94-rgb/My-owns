# qa-verifier DG5 r7: aggregate the axe summaries the product/root/demo runs write (<shots>/<run>/<lang>/axe-summary*.json:
# {screen: {violations: [{id, impact, nodes}]}}): screen checks and violations by impact, per run and language.
# python3 -I axe-aggregate.py <shots root>
import glob, json, os, sys, collections
root = sys.argv[1]
for run in sorted(os.listdir(root)):
    for lang in ("en", "ar"):
        n = 0; imp = collections.Counter(); ids = collections.Counter()
        for f in glob.glob(os.path.join(root, run, lang, "axe-summary*.json")):
            for screen, v in json.load(open(f, encoding="utf8")).items():
                n += 1
                for x in v.get("violations", []):
                    imp[x.get("impact")] += 1; ids[f"{x.get('id')}:{x.get('impact')}"] += 1
        print(f"{run} {lang} screen checks {n} violations (any impact) {dict(imp)} {dict(ids)}")
