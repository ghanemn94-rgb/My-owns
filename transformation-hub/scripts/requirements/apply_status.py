#!/usr/bin/env python3
"""Apply docs/requirements/status-evidence.yaml onto requirements.yaml (status + evidence), then re-render the matrix.

Evidence checks (QA-P1-02): every evidence item must be a plain string (quote items that contain ': '), and every test
file it cites (`*.spec.ts` / `*.test.ts`) must exist in the repository, as must each quoted test title that follows it
(a title may use `...` to elide words; every fragment must appear in the cited file). `--check` validates only.
"""
import pathlib, re, subprocess, sys
import yaml

root = pathlib.Path(__file__).resolve().parents[2]
overlay = yaml.safe_load((root / "docs/requirements/status-evidence.yaml").read_text()) or {}
path = root / "docs/requirements/requirements.yaml"
text = path.read_text()
valid = {"Planned", "Implemented", "Tested", "Simulated", "Not configured", "Blocked", "Deferred"}
SEARCH_DIRS = ["apps/api/test", "apps/api/src", "apps/web/src", "packages", "e2e/tests"]
_index: dict[str, list[pathlib.Path]] = {}


def test_files(name: str) -> list[pathlib.Path]:
    if not _index:
        for d in SEARCH_DIRS:
            for f in (root / d).rglob("*.ts"):
                if "node_modules" in f.parts or "dist" in f.parts:
                    continue
                _index.setdefault(f.name, []).append(f)
    return _index.get(name, [])


FILE_RE = re.compile(r"([\w./-]+\.(?:spec|test)\.ts)")
TITLE_RE = re.compile(r'"([^"]+)"')


def check_evidence(rid: str, items) -> list[str]:
    errors = []
    if not isinstance(items, list):
        return [f"{rid}: evidence must be a list"]
    for item in items:
        if not isinstance(item, str):
            errors.append(f"{rid}: evidence item is not a string (quote it if it contains ': '): {item!r}")
            continue
        # Split the item into segments, each starting at a cited test file; titles belong to the preceding file.
        matches = list(FILE_RE.finditer(item))
        for i, m in enumerate(matches):
            name = pathlib.PurePosixPath(m.group(1)).name
            files = test_files(name)
            if not files:
                errors.append(f"{rid}: cited test file not found: {m.group(1)}")
                continue
            segment = item[m.end() : matches[i + 1].start() if i + 1 < len(matches) else len(item)]
            content = "\n".join(f.read_text() for f in files)
            for title in TITLE_RE.findall(segment):
                for frag in (s.strip() for s in title.split("...")):
                    if frag and frag not in content:
                        errors.append(f"{rid}: title fragment {frag!r} not found in {name}")
    return errors


count = 0
problems: list[str] = []
for rid, v in overlay.items():
    if v["status"] not in valid:
        problems.append(f"{rid}: invalid status {v['status']}")
    if v["status"] == "Tested" and not v.get("evidence"):
        problems.append(f"{rid}: Tested requires evidence")
    problems += check_evidence(rid, v.get("evidence") or [])
if problems:
    sys.exit("status-evidence.yaml problems:\n  " + "\n  ".join(problems))
if "--check" in sys.argv:
    print(f"status-evidence.yaml OK ({len(overlay)} entries)")
    sys.exit(0)

for rid, v in overlay.items():
    m = re.search(r"(- id: " + re.escape(rid) + r"\n(?:(?!- id: ).*\n)*?)(\s+status: )[^\n]*\n(\s+evidence: )[^\n]*(?:\n(?:\s+- [^\n]*))*", text)
    if not m:
        sys.exit(f"{rid} not found or unexpected layout")
    ev = yaml.safe_dump(v.get("evidence") or [], default_flow_style=True, width=10_000, allow_unicode=True).strip()
    text = text[: m.start()] + m.group(1) + m.group(2) + v["status"] + "\n" + m.group(3) + ev + text[m.end():]
    count += 1
path.write_text(text)
yaml.safe_load(text)  # still valid
print(f"applied {count} status updates")
subprocess.run([sys.executable, str(root / "scripts/requirements/render_traceability.py")], check=True)
