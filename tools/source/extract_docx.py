#!/usr/bin/env python3
"""Extract a .docx into ordered Markdown (headings, paragraphs, list items, tables).

Standard library only, so it runs in restricted environments. Every block gets a
stable anchor (B0001, B0002, ...) so requirements can cite exact source blocks.

Usage: extract_docx.py <input.docx> <output.md> [<output.json>]
"""
import json
import sys
import zipfile
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def para_text(p):
    parts = []
    for node in p.iter():
        if node.tag == W + "t":
            parts.append(node.text or "")
        elif node.tag == W + "tab":
            parts.append("\t")
        elif node.tag in (W + "br", W + "cr"):
            parts.append("\n")
    return "".join(parts).strip()


def para_style(p, styles):
    ppr = p.find(W + "pPr")
    if ppr is None:
        return "", False
    style_el = ppr.find(W + "pStyle")
    style_id = style_el.get(W + "val") if style_el is not None else ""
    is_list = ppr.find(W + "numPr") is not None
    return styles.get(style_id, style_id), is_list


def load_styles(z):
    styles = {}
    try:
        root = ET.fromstring(z.read("word/styles.xml"))
    except KeyError:
        return styles
    for s in root.findall(W + "style"):
        sid = s.get(W + "styleId")
        name = s.find(W + "name")
        styles[sid] = name.get(W + "val") if name is not None else sid
    return styles


def table_rows(tbl):
    rows = []
    for tr in tbl.findall(W + "tr"):
        cells = []
        for tc in tr.findall(W + "tc"):
            texts = [para_text(p) for p in tc.findall(".//" + W + "p")]
            cells.append(" ".join(t for t in texts if t).replace("|", "\\|"))
        rows.append(cells)
    return rows


def main():
    src, out_md = sys.argv[1], sys.argv[2]
    out_json = sys.argv[3] if len(sys.argv) > 3 else None
    with zipfile.ZipFile(src) as z:
        styles = load_styles(z)
        body = ET.fromstring(z.read("word/document.xml")).find(W + "body")
        running = []
        for name in sorted(n for n in z.namelist() if n.startswith("word/header") or n.startswith("word/footer")):
            texts = [para_text(p) for p in ET.fromstring(z.read(name)).iter(W + "p")]
            text = " ".join(t for t in texts if t)
            if text:
                running.append(f"{name.split('/')[-1].replace('.xml', '')}: {text}")
    blocks = []
    for el in body:
        if el.tag == W + "p":
            text = para_text(el)
            if not text:
                continue
            style, is_list = para_style(el, styles)
            level = 0
            low = style.lower()
            if low.startswith("heading"):
                try:
                    level = int(low.replace("heading", "").strip() or 1)
                except ValueError:
                    level = 1
            elif low == "title":
                level = 1
            blocks.append({"type": "heading" if level else ("list" if is_list else "para"),
                           "level": level, "style": style, "text": text})
        elif el.tag == W + "tbl":
            blocks.append({"type": "table", "rows": table_rows(el)})
    lines = ["<!-- Extracted by tools/source/extract_docx.py. Running headers/footers (not body blocks; no requirement substance): -->"]
    lines += [f"<!-- {r} -->" for r in running] or ["<!-- none -->"]
    lines.append("")
    for i, b in enumerate(blocks, 1):
        anchor = f"B{i:04d}"
        b["id"] = anchor
        if b["type"] == "heading":
            lines.append(f"{'#' * min(b['level'], 6)} {b['text']} <!-- {anchor} -->\n")
        elif b["type"] == "list":
            lines.append(f"- {b['text']} <!-- {anchor} -->")
        elif b["type"] == "para":
            lines.append(f"\n{b['text']} <!-- {anchor} -->\n")
        else:
            rows = b["rows"]
            if not rows:
                continue
            width = max(len(r) for r in rows)
            norm = [[c.replace("\n", "<br>") for c in r] + [""] * (width - len(r)) for r in rows]
            lines.append(f"\n<!-- {anchor} table -->")
            lines.append("| " + " | ".join(norm[0]) + " |")
            lines.append("|" + "---|" * width)
            for r in norm[1:]:
                lines.append("| " + " | ".join(r) + " |")
            lines.append("")
    with open(out_md, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    if out_json:
        with open(out_json, "w", encoding="utf-8") as f:
            json.dump(blocks, f, ensure_ascii=False, indent=1)
    print(f"blocks={len(blocks)} tables={sum(1 for b in blocks if b['type']=='table')}")


if __name__ == "__main__":
    main()
