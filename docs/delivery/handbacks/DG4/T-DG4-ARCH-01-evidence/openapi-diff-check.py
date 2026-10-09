#!/usr/bin/env python3
"""T-DG4-ARCH-01: checks that the P4 contract change is additive. Usage: openapi-diff-check.py <head.yaml> <new.yaml>.
Every P1-P3 path item, parameter, response, header and schema of <head> must be identical in <new>, except the
response-only PermissionCode enum (append-only) and info.version/description."""
import sys
import yaml

a = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
b = yaml.safe_load(open(sys.argv[2], encoding="utf-8"))
bad = []
for p, item in a["paths"].items():
    if b["paths"].get(p) != item:
        bad.append(f"path changed: {p}")
for sec in ("parameters", "responses", "headers", "schemas", "securitySchemes"):
    for k, v in a["components"].get(sec, {}).items():
        nv = b["components"].get(sec, {}).get(k)
        if k == "PermissionCode":
            old, new = v["enum"], nv["enum"]
            if new[: len(old)] != old:
                bad.append("PermissionCode enum is not append-only")
            continue
        if nv != v:
            bad.append(f"components.{sec}.{k} changed")
old_tags = [t["name"] for t in a["tags"]]
if [t["name"] for t in b["tags"]][: len(old_tags)] != old_tags:
    bad.append("tags reordered")
ops = lambda d: sum(1 for i in d["paths"].values() for m in i if m in ("get", "post", "patch", "put", "delete"))  # noqa: E731
print(f"head operations {ops(a)}, new operations {ops(b)}, added {ops(b) - ops(a)}; info.version {a['info']['version']} -> {b['info']['version']}")
new_perms = b["components"]["schemas"]["PermissionCode"]["enum"][len(a["components"]["schemas"]["PermissionCode"]["enum"]):]
print(f"PermissionCode values appended: {', '.join(new_perms)}")
print("RESULT: " + ("PASS (P1-P3 paths and components unchanged)" if not bad else "FAIL\n  " + "\n  ".join(bad)))
sys.exit(1 if bad else 0)
