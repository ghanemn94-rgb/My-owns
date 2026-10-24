#!/usr/bin/env bash
# qa-verifier DG5 round 2: render export samples for visual inspection (REQ-DLV-037). $1 = directory of samples.
# PDF: page 1 to PNG through LibreOffice Draw's PDF import; DOCX/PPTX/XLSX: converted to PDF by LibreOffice, then page 1
# to PNG. Output: $1/png/<file>.png. LibreOffice runs with a scratch profile ($TMPDIR/lo-profile; HOME is read-only).
set -u
D=$1; mkdir -p "$D/png" "$D/pdf"; export HOME=$TMPDIR/lo-home; mkdir -p $HOME
P="-env:UserInstallation=file://$TMPDIR/lo-profile"
for f in "$D"/*.docx "$D"/*.pptx "$D"/*.xlsx; do [ -f "$f" ] || continue
  timeout 180 soffice $P --headless --convert-to pdf --outdir "$D/pdf" "$f" >/dev/null 2>&1; echo "to-pdf $(basename $f): $?"; done
for f in "$D"/*.pdf "$D"/pdf/*.pdf; do [ -f "$f" ] || continue
  b=$(basename "$f" .pdf); [ "$(dirname $f)" = "$D/pdf" ] && b="$b.via-lo"
  timeout 180 soffice $P --headless --convert-to png --outdir "$D/png" "$f" >/dev/null 2>&1; rc=$?
  [ -f "$D/png/$(basename "$f" .pdf).png" ] && mv "$D/png/$(basename "$f" .pdf).png" "$D/png/$b.png"; echo "to-png $b: $rc"; done
ls -la "$D/png"
