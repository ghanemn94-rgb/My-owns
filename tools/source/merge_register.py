#!/usr/bin/env python3
"""Deterministically merge analyst part files into the requirement register and coverage matrix.

Inputs (all under docs/analysis/parts/):
  req-*.csv            register rows (header = register columns)
  mp-coverage-*.csv    master-prompt coverage rows (block_id,disposition,req_ids,rationale)
  ref-additions-*.csv  req_id,add_refs  - extra block anchors to append to an existing requirement's source_ref
Outputs:
  docs/delivery/requirements.csv
  docs/analysis/master-prompt-coverage.csv
The merge never edits content other than appending source_ref anchors; conflicts (duplicate IDs or blocks) fail.
"""
import csv
import glob
import io
import re
import sys

COLUMNS = ["req_id", "class", "title", "source_ref", "source_heading", "template_id", "input_fields", "procedure",
           "output", "owner_roles", "permissions", "automation", "screen_api", "acceptance", "increments",
           "final_gate", "status", "evidence", "notes"]
AREA_ORDER = ["PB", "DLV"] + [f"S{n:02d}" for n in range(1, 22)]


def read(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def sort_key(req_id):
    m = re.match(r"REQ-([A-Z0-9]+)-(\d+)$", req_id)
    if not m:
        return (999, req_id)
    area = m.group(1)
    return (AREA_ORDER.index(area) if area in AREA_ORDER else 998, int(m.group(2)))


def write_csv(path, header, rows):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=header, lineterminator="\n", quoting=csv.QUOTE_MINIMAL)
    w.writeheader()
    for r in rows:
        w.writerow({k: r.get(k, "") for k in header})
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(buf.getvalue())


def main():
    problems = []
    reqs = {}
    for path in sorted(glob.glob("docs/analysis/parts/req-*.csv")):
        rows = read(path)
        if rows and list(rows[0].keys()) != COLUMNS:
            problems.append(f"{path}: header differs from register columns")
            continue
        for r in rows:
            rid = r["req_id"].strip()
            if rid in reqs:
                problems.append(f"{path}: duplicate {rid} (already from {reqs[rid]['_src']})")
                continue
            r["_src"] = path
            reqs[rid] = r
    for path in sorted(glob.glob("docs/analysis/parts/ref-additions-*.csv")):
        for r in read(path):
            rid = r["req_id"].strip()
            if rid not in reqs:
                problems.append(f"{path}: ref addition for unknown {rid}")
                continue
            refs = [x.strip() for x in reqs[rid]["source_ref"].split(";") if x.strip()]
            for add in [x.strip() for x in r["add_refs"].split(";") if x.strip()]:
                if add not in refs:
                    refs.append(add)
            reqs[rid]["source_ref"] = ";".join(refs)
    cov = {}
    for path in sorted(glob.glob("docs/analysis/parts/mp-coverage-*.csv")):
        for r in read(path):
            b = r["block_id"].strip()
            if b in cov:
                problems.append(f"{path}: duplicate coverage row for {b}")
                continue
            cov[b] = r
    if problems:
        print("MERGE FAILED")
        for p in problems:
            print("  -", p)
        sys.exit(1)
    ordered = sorted(reqs.values(), key=lambda r: sort_key(r["req_id"]))
    write_csv("docs/delivery/requirements.csv", COLUMNS, ordered)
    write_csv("docs/analysis/master-prompt-coverage.csv", ["block_id", "disposition", "req_ids", "rationale"],
              [cov[k] for k in sorted(cov)])
    by_area = {}
    for r in ordered:
        a = r["req_id"].split("-")[1]
        by_area[a] = by_area.get(a, 0) + 1
    print(f"merged {len(ordered)} requirements {by_area}; {len(cov)} master-prompt coverage rows")


if __name__ == "__main__":
    main()
