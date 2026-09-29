#!/usr/bin/env python3
"""Apply docs/requirements/status-evidence.yaml onto requirements.yaml (status + evidence), then re-render the matrix."""
import pathlib, re, subprocess, sys
import yaml
root = pathlib.Path(__file__).resolve().parents[2]
overlay = yaml.safe_load((root / "docs/requirements/status-evidence.yaml").read_text()) or {}
path = root / "docs/requirements/requirements.yaml"
text = path.read_text()
valid = {"Planned", "Implemented", "Tested", "Simulated", "Not configured", "Blocked", "Deferred"}
count = 0
for rid, v in overlay.items():
    if v["status"] not in valid: sys.exit(f"{rid}: invalid status {v['status']}")
    if v["status"] == "Tested" and not v.get("evidence"): sys.exit(f"{rid}: Tested requires evidence")
    m = re.search(r"(- id: " + re.escape(rid) + r"\n(?:(?!- id: ).*\n)*?)(\s+status: )[^\n]*\n(\s+evidence: )[^\n]*(?:\n(?:\s+- [^\n]*))*", text)
    if not m: sys.exit(f"{rid} not found or unexpected layout")
    ev = yaml.safe_dump(v.get("evidence") or [], default_flow_style=True, width=10_000, allow_unicode=True).strip()
    text = text[: m.start()] + m.group(1) + m.group(2) + v["status"] + "\n" + m.group(3) + ev + text[m.end():]
    count += 1
path.write_text(text)
yaml.safe_load(text)  # still valid
print(f"applied {count} status updates")
subprocess.run([sys.executable, str(root / "scripts/requirements/render_traceability.py")], check=True)
