# usage: python3 -I 21-query-ops.py <openapi.yaml> <out.json> : GET operations with query parameters (and the 429 check)
import json, sys, yaml
d = yaml.safe_load(open(sys.argv[1]))
ops, n, no429 = [], 0, []
for p, item in d["paths"].items():
    for m, op in item.items():
        if m not in ("get", "post", "put", "patch", "delete"): continue
        n += 1
        if "429" not in op.get("responses", {}): no429.append(op["operationId"])
        ps = [d["components"]["parameters"][x["$ref"].split("/")[-1]] if "$ref" in x else x for x in item.get("parameters", []) + op.get("parameters", [])]
        q = [x["name"] for x in ps if x["in"] == "query"]
        if m == "get" and q: ops.append({"operationId": op["operationId"], "path": p, "query": q})
json.dump(ops, open(sys.argv[2], "w"), indent=1)
print("operations", n, "| operations without a 429 response:", no429, "| GET operations with query parameters:", len(ops), "| query parameters:", sum(len(o["query"]) for o in ops))
