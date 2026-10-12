#!/usr/bin/env python3
"""qa-verifier DG4 round 7: harvest e2e failure artifacts. argv[1] = test-results dir of a copy, argv[2] = evidence dir.
For each failed test directory: copy error-context.md and test-failed-*.png, and list from trace.zip every network
request that failed in the browser (status <= 0, e.g. net::ERR_INSUFFICIENT_RESOURCES) or answered >= 500, plus whether
the page showed the route load error ('This page could not be loaded')."""
import sys, os, json, zipfile, shutil, glob, io
src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
summary = []
for d in sorted(glob.glob(os.path.join(src, "*/"))):
    name = os.path.basename(d.rstrip("/"))
    files = os.listdir(d)
    if not files: continue
    out = os.path.join(dst, name[:90]); os.makedirs(out, exist_ok=True)
    for f in files:
        if f.endswith(".png") or f == "error-context.md": shutil.copy(os.path.join(d, f), out)
    ctx = open(os.path.join(d, "error-context.md"), encoding="utf-8").read() if "error-context.md" in files else ""
    routefail = ("could not be loaded" in ctx) or ("تعذّر تحميل هذه الصفحة" in ctx)
    failed = []
    if "trace.zip" in files:
        with zipfile.ZipFile(os.path.join(d, "trace.zip")) as z:
            for n in z.namelist():
                if not n.endswith(".network"): continue
                for line in io.TextIOWrapper(z.open(n), encoding="utf-8"):
                    try: s = json.loads(line).get("snapshot", {})
                    except Exception: continue
                    st = s.get("response", {}).get("status")
                    if st is None or st <= 0 or st >= 500:
                        failed.append(f'{s.get("startedDateTime")} {s.get("request",{}).get("method")} {s.get("request",{}).get("url","").split("//",1)[-1].split("/",1)[-1]} {st} {s.get("response",{}).get("_failureText","")}')
    with open(os.path.join(out, "network-failures.txt"), "w") as fh:
        fh.write("\n".join(failed) + ("\n" if failed else "(none in trace)\n" if "trace.zip" in files else "(no trace.zip)\n"))
    summary.append(f"{name}: files={sorted(files)} route_load_error_on_page={routefail} failed_requests={len(failed)} {failed[:3]}")
open(os.path.join(dst, "SUMMARY.txt"), "w").write("\n".join(summary) + "\n")
print("\n".join(summary))
