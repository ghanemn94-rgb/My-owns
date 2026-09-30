#!/usr/bin/env bash
# =====================================================================================================================
# Secret scan — REQ-SEC-012 (no secrets in source control, frontend assets or test reports), REQ-ARC-015 (web bundle
# free of provider keys and database URLs), REQ-SET-008 (no static credentials in the repository).
# Scanner: gitleaks (MIT) with scripts/ops/gitleaks.toml (default rules + a URL-embedded-password rule; allow-list
# limited to synthetic dev/CI values). Findings are printed REDACTED; exit 1 on any finding.
#
#   bash scripts/ops/secret-scan.sh history            git history of the checked-out revision (all ancestors of HEAD,
#                                                       whole repository); needs a full clone (fetch-depth: 0)
#   bash scripts/ops/secret-scan.sh tree               committed tree of HEAD (git archive; local build output ignored)
#   bash scripts/ops/secret-scan.sh bundle <dir>       built web client bundle (apps/web/.next/static): gitleaks, plus
#                                                       no database/queue connection URL of any kind
#   bash scripts/ops/secret-scan.sh reports <path>...  test reports and logs; archives (Playwright traces) are opened
#                                                       and the data embedded in Playwright HTML reports is unpacked
#
# Env: GITLEAKS (binary path; default `gitleaks` on PATH) · SECRET_SCAN_REPORT_DIR (redacted JSON reports; default
# .dev/secret-scan). Install the pinned, checksum-verified release as in the CI job `secret-scan`
# (.github/workflows/transformation-hub-ci.yml); docs/deployment/secrets.md describes the policy.
# =====================================================================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG="$ROOT/scripts/ops/gitleaks.toml"
GL="${GITLEAKS:-$(command -v gitleaks || true)}"
OUT="${SECRET_SCAN_REPORT_DIR:-$ROOT/.dev/secret-scan}"
MODE="${1:-}"
[ $# -gt 0 ] && shift

usage() { sed -n '8,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2; exit 2; }
[ -n "$MODE" ] || usage
[ -n "$GL" ] && [ -x "$GL" ] || { echo "gitleaks not found (set GITLEAKS=/path/to/gitleaks)" >&2; exit 2; }
mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILS=0

# gitleaks <label> <subcommand> <args...>: redacted findings on stdout, redacted JSON report in $OUT/<label>.json.
scan() {
  local label="$1"; shift
  local rc=0
  "$GL" "$@" --config "$CONFIG" --ignore-gitleaks-allow --redact=100 --no-banner --no-color --verbose \
    --report-format json --report-path "$OUT/$label.json" || rc=$?
  if [ "$rc" = 0 ]; then echo "PASS  $label: no findings"
  else echo "FAIL  $label: gitleaks exit $rc (findings above, redacted; report $OUT/$label.json)"; FAILS=$((FAILS + 1)); fi
}

echo "gitleaks $("$GL" version) · config $(realpath --relative-to="$ROOT" "$CONFIG")"
# A .gitleaksignore silently suppresses findings by fingerprint; every exception must be a reviewed allow-list entry in
# gitleaks.toml instead (SEC-P1S-02). Refuse to scan while one exists in the repository or the project directory.
REPO_ROOT="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null || echo "$ROOT")"
for f in "$ROOT/.gitleaksignore" "$REPO_ROOT/.gitleaksignore"; do
  if [ -e "$f" ]; then echo "FAIL  $f exists: fingerprint suppressions are not allowed — use a reviewed entry in scripts/ops/gitleaks.toml" >&2; exit 1; fi
done
if git -C "$REPO_ROOT" ls-files --error-unmatch .gitleaksignore '*/.gitleaksignore' >/dev/null 2>&1; then
  echo "FAIL  a committed .gitleaksignore exists: fingerprint suppressions are not allowed" >&2; exit 1
fi
case "$MODE" in
  history)
    REPO="$(git -C "$ROOT" rev-parse --show-toplevel)"
    if [ "$(git -C "$REPO" rev-parse --is-shallow-repository)" = true ]; then
      echo "FAIL  history: shallow clone — the full history cannot be scanned (use actions/checkout with fetch-depth: 0)"; exit 1
    fi
    echo "history: $(git -C "$REPO" rev-list --count HEAD) commits reachable from HEAD $(git -C "$REPO" rev-parse --short HEAD) (whole repository)"
    # --log-opts replaces gitleaks' default `--all`: other branches/remotes are not part of this revision.
    scan history git --log-opts="--full-history HEAD" "$REPO"
    ;;
  tree)
    REPO="$(git -C "$ROOT" rev-parse --show-toplevel)"
    git -C "$REPO" archive --format=tar HEAD | tar -x -C "$TMP"
    echo "tree: $(find "$TMP" -type f | wc -l) committed files at HEAD $(git -C "$REPO" rev-parse --short HEAD)"
    scan tree dir "$TMP"
    ;;
  bundle)
    [ $# -eq 1 ] && [ -d "$1" ] || { echo "bundle: expected one existing directory (apps/web/.next/static)" >&2; exit 2; }
    n_js="$(find "$1" -type f -name '*.js' | wc -l)"
    [ "$n_js" -gt 0 ] || { echo "FAIL  bundle: no JavaScript files in $1 — not a Next.js static build output" >&2; exit 1; }
    echo "bundle: $(find "$1" -type f | wc -l) files ($n_js JavaScript) in $1"
    scan bundle dir "$1"
    # REQ-ARC-015: the client bundle must not contain any database/queue connection URL, with or without a password.
    if grep -rIlE '(postgres(ql)?|mysql|mariadb|mongodb(\+srv)?|rediss?|amqps?)://' "$1" >"$TMP/dburls.txt"; then
      echo "FAIL  bundle: database/queue connection URL found in:"; sed 's/^/        /' "$TMP/dburls.txt"; FAILS=$((FAILS + 1))
    else echo "PASS  bundle: no database/queue connection URL"; fi
    ;;
  reports)
    [ $# -ge 1 ] || { echo "reports: expected one or more paths" >&2; exit 2; }
    i=0
    for p in "$@"; do
      [ -e "$p" ] || { echo "FAIL  reports: $p does not exist"; FAILS=$((FAILS + 1)); continue; }
      i=$((i + 1))
      label="reports-$i-$(printf '%s' "$(basename "$p")" | tr -c 'A-Za-z0-9._-' '_')"
      echo "reports: $p ($(find "$p" -type f | wc -l) files)"
      scan "$label" dir --max-archive-depth 3 "$p"
      # Playwright's HTML report embeds its data (test steps, errors, stdout, attachment list) as a base64 zip inside
      # index.html, which a text scanner would not open: unpack it and scan the contents too.
      while IFS= read -r html; do
        sub="$label-embedded-$(printf '%s' "$html" | cksum | cut -d' ' -f1)"
        d="$TMP/$sub"
        mkdir -p "$d"
        if python3 - "$html" "$d/report-data.zip" <<'PY'
import base64, re, sys
m = re.search(rb'data:application/zip;base64,([A-Za-z0-9+/=]+)', open(sys.argv[1], 'rb').read())
if not m: sys.exit(1)
open(sys.argv[2], 'wb').write(base64.b64decode(m.group(1)))
PY
        then
          echo "reports: unpacked the data embedded in $html"
          scan "$sub" dir --max-archive-depth 3 "$d"
        fi
      done < <(grep -rlE 'data:application/zip;base64,' --include=index.html "$p" 2>/dev/null || true)
    done
    ;;
  *) usage ;;
esac

if [ "$FAILS" = 0 ]; then echo "SECRET SCAN ($MODE): PASS"; else echo "SECRET SCAN ($MODE): FAIL ($FAILS)"; fi
[ "$FAILS" = 0 ]
