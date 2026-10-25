#!/usr/bin/env python3
# qa-verifier DG5 round 3: direction/font summary of 07-inspect-samples.txt. Per file the marker check is:
#  PDF  ar: /Lang=ar* and an embedded IBM Plex Sans Arabic font; en: /Lang=en*
#  DOCX ar: w:bidi>0 and w:rtl>0 and the IBM Plex Sans Arabic font; en: w:bidi=0 (no right-to-left paragraph; an
#       Arabic DATA run inside an English document, e.g. the gate pack's 'Criterion (Arabic)' column, is correctly a
#       w:rtl run, so w:rtl>0 is allowed in en when the file also names the Arabic font for those runs)
#  PPTX ar: rtl_paragraphs>0 and the IBM Plex Sans Arabic typeface; en: rtl_paragraphs=0
#  XLSX ar: every sheet rightToLeft=True; en: none
#  CSV  both: BOM=True (UTF-8 with BOM, so spreadsheet tools read Arabic correctly)
# Output: one line per (format, language, ok) with its count, then the files failing their check.
import re, sys
from collections import Counter
cur, info = None, {}
for line in open(sys.argv[1], encoding="utf-8"):
    m = re.match(r"^===== (\S+)\s+\((\w+), (\w+), \d+ bytes\)", line)
    if m:
        cur = m.group(1); info[cur] = {"fmt": m.group(2), "lang": m.group(3), "meta": ""}; continue
    if cur and not info[cur]["meta"] and line.startswith("  ") and not line.startswith("   |"):
        info[cur]["meta"] = line.strip()
def ok(i):
    f, l, s = i["fmt"], i["lang"], i["meta"]
    if f == "pdf":
        return ("/Lang=ar" in s and "IBMPlexSansArabic" in s) if l == "ar" else "/Lang=en" in s
    if f == "docx":
        b = int(re.search(r"w:bidi=(\d+)", s).group(1)); r = int(re.search(r"w:rtl=(\d+)", s).group(1))
        return (b > 0 and r > 0 and "IBM Plex Sans Arabic" in s) if l == "ar" else (b == 0 and (r == 0 or "IBM Plex Sans Arabic" in s))
    if f == "pptx":
        n = int(re.search(r"rtl_paragraphs=(\d+)", s).group(1))
        return (n > 0 and "IBM Plex Sans Arabic" in s) if l == "ar" else n == 0
    if f == "xlsx":
        v = re.search(r"rightToLeft=\[([^\]]*)\]", s).group(1).split(", ")
        return all(x == "True" for x in v) if l == "ar" else all(x == "False" for x in v)
    if f == "csv":
        return "BOM=True" in s
    return False
c = Counter((i["fmt"], i["lang"], ok(i)) for i in info.values())
print(f"qa-verifier DG5 round 3: direction/font summary of {sys.argv[1].split('/')[-1]} ({len(info)} files)")
for k in sorted(c): print(k, c[k])
print("files failing the marker check:", sorted(n for n, i in info.items() if not ok(i)))
