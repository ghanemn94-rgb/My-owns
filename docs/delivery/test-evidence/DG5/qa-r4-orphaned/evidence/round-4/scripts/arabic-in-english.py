# qa-verifier r4: Arabic letters (U+0600-U+06FF) in each English sample's text parts (OOXML XML parts; CSV as text).
import zipfile, re, glob, os
AR = re.compile('[؀-ۿ]+(?:[\\s؀-ۿ]*[؀-ۿ])?')
BOM = b'\xef\xbb\xbf'
for f in sorted(glob.glob('samples/*-en.*')):
    ext = f.rsplit('.', 1)[1]; hits = []
    if ext in ('docx', 'pptx', 'xlsx'):
        z = zipfile.ZipFile(f)
        for n in z.namelist():
            if n.endswith('.xml'):
                hits += [(n, m) for m in AR.findall(z.read(n).decode('utf-8', 'replace'))]
    elif ext == 'csv':
        bom = open(f, 'rb').read(3) == BOM
        hits = [('csv', m) for m in AR.findall(open(f, encoding='utf-8-sig').read())]
        print(os.path.basename(f) + ': starts with UTF-8 BOM = ' + str(bom))
    else:
        continue
    print('== ' + os.path.basename(f) + ': ' + str(len(hits)) + ' Arabic runs ' + str(sorted(set(h[1] for h in hits))[:8]))
