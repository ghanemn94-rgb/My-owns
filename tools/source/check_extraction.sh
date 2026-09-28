#!/usr/bin/env bash
# Verifies the committed source extraction is reproducible from the committed originals.
set -euo pipefail
cd "$(dirname "$0")/../.."
EXPECTED_DOCX_SHA256="2584a35282804e639a697478eae75a55a43cfb8c551345dfc7636b9b34548ad2"
actual="$(sha256sum docs/source/Business_Transformation_Playbook.docx | cut -d' ' -f1)"
[[ "$actual" == "$EXPECTED_DOCX_SHA256" ]] || { echo "FAIL: playbook docx hash $actual != $EXPECTED_DOCX_SHA256"; exit 1; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
python3 tools/source/extract_docx.py docs/source/Business_Transformation_Playbook.docx "$tmp/playbook.md" "$tmp/playbook.blocks.json" >/dev/null
python3 tools/source/split_master_prompt.py docs/source/master-prompt-v2.0.md "$tmp/mp.json" "$tmp/mp.md" >/dev/null
diff -q "$tmp/playbook.md" docs/source/playbook.md
diff -q "$tmp/playbook.blocks.json" docs/source/playbook.blocks.json
diff -q "$tmp/mp.json" docs/source/master-prompt.blocks.json
diff -q "$tmp/mp.md" docs/source/master-prompt.anchored.md
echo "PASS source extraction reproducible (docx sha256 $actual; 165 playbook blocks; $(python3 -c "import json;print(len(json.load(open('docs/source/master-prompt.blocks.json'))))") master-prompt blocks)"
