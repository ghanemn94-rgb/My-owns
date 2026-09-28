#!/usr/bin/env python3
"""Split the master prompt into anchored blocks (M0001, ...) with their section numbers.

Every non-empty line (paragraph, bullet, numbered item or table row) becomes a block.
Section headings look like "7 KPI engine and change propagation" or "0.3 Assignment contract ...".

Usage: split_master_prompt.py <master-prompt.md> <out.json> <out.md>
"""
import json
import re
import sys

HEADING = re.compile(r"^(\d{1,2}(?:\.\d)?) ([A-Z][^|]{3,120})$")


def main():
    src, out_json, out_md = sys.argv[1:4]
    lines = open(src, encoding="utf-8").read().splitlines()
    section, title = "preamble", "Preamble"
    blocks = []
    for raw in lines:
        line = raw.strip()
        if not line or set(line) <= set("─-|: "):
            continue
        m = HEADING.match(line)
        kind = "para"
        if m and not line.endswith("."):
            section, title = m.group(1), m.group(2)
            kind = "heading"
        elif line.startswith("|"):
            kind = "table-row"
        elif line.startswith("•"):
            kind = "bullet"
        elif re.match(r"^\d{1,2}\. ", line):
            kind = "numbered"
        blocks.append({"id": f"M{len(blocks) + 1:04d}", "section": section,
                       "section_title": title, "kind": kind, "text": line})
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(blocks, f, ensure_ascii=False, indent=1)
    with open(out_md, "w", encoding="utf-8") as f:
        for b in blocks:
            prefix = "## " if b["kind"] == "heading" else ""
            f.write(f"{prefix}[{b['id']} §{b['section']}] {b['text']}\n\n")
    kinds = {}
    for b in blocks:
        kinds[b["kind"]] = kinds.get(b["kind"], 0) + 1
    sections = sorted({b["section"] for b in blocks}, key=lambda s: [int(x) if x.isdigit() else -1 for x in s.split(".")] if s != "preamble" else [-1])
    print(f"blocks={len(blocks)} kinds={kinds}")
    print("sections=" + ",".join(sections))


if __name__ == "__main__":
    main()
