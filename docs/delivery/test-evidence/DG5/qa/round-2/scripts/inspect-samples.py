#!/usr/bin/env python3
# qa-verifier DG5 round 2 (REQ-DLV-037): content-level inspection of exported samples, independent of the product's
# own readers (packages/reporting/src/*/read.ts). Standard library only. Raster rendering was BLOCKED: LibreOffice
# cannot start in this sandbox ("no valid pipe path found": its IPC pipe needs a writable /tmp, which is read-only).
# For each file: format, language (from the file name), size, and
#  - PDF: page count, /Lang, embedded fonts (BaseFont, FontFile2 present), text decoded through each font's ToUnicode
#    CMap from the page content streams (Tj/TJ hex strings), in drawing order, first lines;
#  - DOCX: w:bidi / w:rtl markers, rFonts (ascii/cs), header/footer/body paragraphs (first lines);
#  - PPTX: slide count, rtl="1" paragraphs, typefaces, first slide texts;
#  - XLSX: sheets, rightToLeft, formulas (f elements), shared-string sample;
#  - CSV: BOM, first rows.
# LIMITS of the PDF text decoder (best effort, for orientation only): it maps glyph codes through each font's ToUnicode
# CMap with a simplified content-stream parser (Tf, Tj, TJ, q/Q). It does not follow every graphics-state rule, so
# some footer runs decode with the wrong font subset (e.g. "OrganiBational"), and glyphs that pdfkit draws without a
# ToUnicode entry (shaped Arabic forms) show as U+FFFD; Arabic runs come out in visual (drawn) order. These are
# artefacts of this decoder, not findings: the A15 suites assert the exact texts through the product's reader. The
# OOXML (DOCX/PPTX/XLSX) and CSV inspection is exact (zip + XML / CSV parsing).
# Usage: python3 -I inspect-samples.py <dir> [<dir> ...]
import re, sys, zlib, zipfile, os, csv, io
from xml.etree import ElementTree as ET

def pdf_objects(data):
    objs = {}
    for m in re.finditer(rb"(\d+)\s+0\s+obj(.*?)endobj", data, re.S):
        objs[int(m.group(1))] = m.group(2)
    return objs

def stream_of(body):
    m = re.search(rb"stream\r?\n(.*?)\r?\nendstream", body, re.S)
    if not m: return b""
    raw = m.group(1)
    if b"/FlateDecode" in body[: body.find(b"stream")]:
        try: return zlib.decompress(raw)
        except Exception:
            try: return zlib.decompressobj().decompress(raw)
            except Exception: return b""
    return raw

def parse_cmap(text):
    cmap = {}
    for blk in re.findall(rb"beginbfchar(.*?)endbfchar", text, re.S):
        for a, b in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", blk):
            cmap[int(a, 16)] = bytes.fromhex(b.decode()).decode("utf-16-be", "replace")
    for blk in re.findall(rb"beginbfrange(.*?)endbfrange", text, re.S):
        # Two forms: <lo> <hi> <base>  and  <lo> <hi> [<u1> <u2> ...] (pdfkit writes the array form).
        for a, b, arr, c in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:\[([^\]]*)\]|<([0-9A-Fa-f]+)>)", blk):
            lo, hi = int(a, 16), int(b, 16)
            if arr:
                for i, u in enumerate(re.findall(rb"<([0-9A-Fa-f]+)>", arr)):
                    cmap[lo + i] = bytes.fromhex(u.decode()).decode("utf-16-be", "replace")
            else:
                base = int(c, 16)
                for i in range(lo, hi + 1): cmap[i] = chr(base + i - lo)
    return cmap

def inspect_pdf(data):
    objs = pdf_objects(data)
    out = {}
    out["pages"] = len(re.findall(rb"/Type\s*/Page[^s]", data))
    lang = re.search(rb"/Lang\s*\(([^)]*)\)", data)
    out["lang"] = lang.group(1).decode("latin-1") if lang else None
    fonts, cmaps = {}, {}
    for n, body in objs.items():
        if b"/Type /Font" in body or b"/Type/Font" in body:
            bf = re.search(rb"/BaseFont\s*/([^\s/>\]]+)", body)
            tu = re.search(rb"/ToUnicode\s+(\d+)\s+0\s+R", body)
            fonts[n] = bf.group(1).decode() if bf else "?"
            if tu and int(tu.group(1)) in objs: cmaps[n] = parse_cmap(stream_of(objs[int(tu.group(1))]))
    out["fonts"] = sorted(set(re.sub(r"^[A-Z]{6}\+", "", f) for f in fonts.values()))
    out["embedded_fontfile2"] = sum(1 for b in objs.values() if b"/FontFile2" in b)
    # resource name -> font object, per resources dict
    resmap = {}
    for body in objs.values():
        for fm in re.finditer(rb"/Font\s*<<(.*?)>>", body, re.S):
            for name, num in re.findall(rb"/([A-Za-z0-9_.+-]+)\s+(\d+)\s+0\s+R", fm.group(1)):
                resmap[name.decode()] = int(num)
    lines = []
    for n, body in objs.items():
        if b"/Length" not in body or b"stream" not in body: continue
        s = stream_of(body)
        if b"Tf" not in s: continue
        cur = None; line = []; stack = []
        # q/Q save and restore the graphics state, which includes the current font.
        for tok in re.finditer(rb"/([A-Za-z0-9_.+-]+)\s+[\d.]+\s+Tf|\[(.*?)\]\s*TJ|<([0-9A-Fa-f]*)>\s*Tj|(T\*|Td|TD|Tm|ET)|(?<![^\s])(q|Q)(?![^\s])", s, re.S):
            if tok.group(5):
                if tok.group(5) == b"q": stack.append(cur)
                elif stack: cur = stack.pop()
            elif tok.group(1):
                cur = cmaps.get(resmap.get(tok.group(1).decode(), -1), {})
            elif tok.group(2) is not None or tok.group(3) is not None:
                hexes = re.findall(rb"<([0-9A-Fa-f]*)>", tok.group(2)) if tok.group(2) is not None else [tok.group(3)]
                for h in hexes:
                    h = h.decode()
                    w = 4 if len(h) % 4 == 0 else 2
                    line.append("".join((cur or {}).get(int(h[i:i + w], 16), "�") for i in range(0, len(h), w)))
            else:
                if line: lines.append("".join(line)); line = []
        if line: lines.append("".join(line))
    out["text_lines"] = [l for l in (x.strip() for x in lines) if l]
    return out

def xml_texts(xml, tag):
    return [t for t in re.findall(r"<%s(?: [^>]*)?>([^<]*)</%s>" % (tag, tag), xml) if t.strip()]

def inspect_docx(z):
    parts = {n: z.read(n).decode("utf-8") for n in z.namelist() if re.match(r"word/(document|header\d*|footer\d*)\.xml$", n)}
    doc = parts.get("word/document.xml", "")
    fonts = sorted(set(re.findall(r'w:(?:ascii|cs|hAnsi)="([^"]+)"', "".join(parts.values()))))
    paras = []
    for name in sorted(parts):
        for p in re.findall(r"<w:p[ >].*?</w:p>", parts[name], re.S):
            t = "".join(re.findall(r"<w:t(?: [^>]*)?>([^<]*)</w:t>", p))
            if t.strip(): paras.append(f"[{name.split('/')[1][:-4]}] {t}")
    return {"bidi": len(re.findall(r"<w:bidi(?:/| w:val=\"(?:1|true)\"/)>", doc)), "rtl_runs": len(re.findall(r"<w:rtl(?:/| w:val=\"(?:1|true)\"/)>", doc)), "fonts": fonts, "paragraphs": paras}

def inspect_pptx(z):
    slides = sorted([n for n in z.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)], key=lambda s: int(re.findall(r"\d+", s)[-1]))
    allxml = "".join(z.read(s).decode("utf-8") for s in slides)
    texts = []
    for s in slides[:3]:
        xml = z.read(s).decode("utf-8")
        for p in re.findall(r"<a:p>.*?</a:p>|<a:p .*?</a:p>", xml, re.S):
            t = "".join(re.findall(r"<a:t>([^<]*)</a:t>", p))
            mark = " rtl" if 'rtl="1"' in p else ""
            if t.strip(): texts.append(f"[{s.split('/')[-1][:-4]}{mark}] {t}")
    return {"slides": len(slides), "rtl_paragraphs": allxml.count('rtl="1"'), "typefaces": sorted(set(re.findall(r'typeface="([^"]+)"', allxml))), "texts": texts}

def inspect_xlsx(z):
    wb = z.read("xl/workbook.xml").decode("utf-8")
    sheets = re.findall(r'<sheet [^>]*name="([^"]+)"', wb)
    out = {"sheets": sheets, "rightToLeft": [], "formulas": [], "strings": []}
    for n in sorted(x for x in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", x)):
        xml = z.read(n).decode("utf-8")
        out["rightToLeft"].append('rightToLeft="1"' in xml)
        out["formulas"] += re.findall(r"<f>([^<]*)</f>", xml)
    if "xl/sharedStrings.xml" in z.namelist():
        ss = z.read("xl/sharedStrings.xml").decode("utf-8")
        out["strings"] = re.findall(r"<t(?: [^>]*)?>([^<]*)</t>", ss)
    return out

def main():
    for d in sys.argv[1:]:
        for f in sorted(os.listdir(d)):
            p = os.path.join(d, f)
            if not os.path.isfile(p): continue
            m = re.search(r"\.(en|ar)\.(pdf|docx|pptx|xlsx|csv)$", f)
            if not m: continue
            lang, fmt = m.groups(); data = open(p, "rb").read()
            print(f"===== {f}  ({fmt}, {lang}, {len(data)} bytes)")
            try:
                if fmt == "pdf":
                    r = inspect_pdf(data)
                    print(f"  pages={r['pages']} /Lang={r['lang']} fonts={r['fonts']} embedded_fontfile2={r['embedded_fontfile2']}")
                    for l in r["text_lines"][:14]: print("   |", l[:160])
                    print(f"  ... {len(r['text_lines'])} text lines; replacement chars: {sum(l.count(chr(0xfffd)) for l in r['text_lines'])}")
                elif fmt == "docx":
                    r = inspect_docx(zipfile.ZipFile(p))
                    print(f"  w:bidi={r['bidi']} w:rtl={r['rtl_runs']} fonts={r['fonts']}")
                    for l in r["paragraphs"][:14]: print("   |", l[:160])
                    print(f"  ... {len(r['paragraphs'])} paragraphs")
                elif fmt == "pptx":
                    r = inspect_pptx(zipfile.ZipFile(p))
                    print(f"  slides={r['slides']} rtl_paragraphs={r['rtl_paragraphs']} typefaces={r['typefaces']}")
                    for l in r["texts"][:14]: print("   |", l[:160])
                elif fmt == "xlsx":
                    r = inspect_xlsx(zipfile.ZipFile(p))
                    print(f"  sheets={r['sheets']} rightToLeft={r['rightToLeft']} formulas={r['formulas'][:6]}")
                    for l in r["strings"][:12]: print("   |", l[:160])
                else:
                    t = data.decode("utf-8-sig"); rows = list(csv.reader(io.StringIO(t)))
                    bom = data.startswith(b"\xef\xbb\xbf")
                    print(f"  BOM={bom} rows={len(rows)}")
                    for row in rows[:6]: print("   |", " ; ".join(row)[:160])
            except Exception as e:
                print(f"  INSPECTION ERROR: {type(e).__name__}: {e}")

main()
