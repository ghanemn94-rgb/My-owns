# Dumps the heading level of each of the 165 body items of docs/source/Business_Transformation_Playbook.docx
# (T-DG5-BE-Q). Usage: python3 -I docx-headings.py <path-to-docx> > docx-headings.txt
# Bold paragraph sz 16 = h1 (kicker), sz 46/68 = h2 (title), sz 28 = h3 (sub-heading); other paragraphs body; tables.
import re, sys, zipfile
d = zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode("utf8").split("<w:body>")[1]
n = 0
for m in re.finditer(r"<w:p[ >].*?</w:p>|<w:tbl>.*?</w:tbl>", d, re.S):
    x = m.group(0)
    if x.startswith("<w:tbl"):
        kind = "table"
    else:
        t = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", x))
        if not t.strip():
            continue
        sz = re.search(r'<w:sz w:val="(\d+)"', x)
        bold = "<w:b/>" in x or "<w:b " in x
        size = sz.group(1) if sz else None
        kind = {"16": "h1", "46": "h2", "68": "h2", "28": "h3"}.get(size, "body") if bold else "body"
    n += 1
    print(f"B{n:04d} {kind}")
