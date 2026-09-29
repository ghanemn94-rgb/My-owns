#!/usr/bin/env bash
# =====================================================================================================================
# Private-mode egress check (AT-22, threat model C-18 / T-70): scan BUILT artefacts for absolute http(s) URLs that
# could make a browser or server contact a host outside the approved allowlist (public fonts, CDNs, telemetry, …).
#
#   bash scripts/ops/egress-check.sh                       # scans apps/web/.next (if built) and apps/api/dist
#   bash scripts/ops/egress-check.sh --web-dir /path/.next --api-dir /path/dist --allow extra-host.internal
#
# Severity
#   FAIL  browser-fetchable reference to a non-allowlisted host: CSS url()/@import, HTML src/href/srcset,
#         <link rel=preconnect|dns-prefetch|preload>, or any URL in compiled API code (apps/api/dist)
#   WARN  other non-allowlisted URL strings inside web JavaScript bundles (often documentation links in error
#         messages); review each — they are only a problem if the code fetches them
# Allowlisted (reference-only, never fetched): XML/SVG namespaces, JSON-Schema identifiers, framework error-doc
# links, reserved/example domains and loopback — see ALLOW below — plus hosts from HUB_EGRESS_ALLOWLIST and --allow.
# node_modules are NOT scanned by default (thousands of doc links); use --include-node-modules for an inventory.
# This is a static check. The runtime proof is the default-deny NetworkPolicy + a browser HAR / proxy log showing
# same-origin traffic only (docs/deployment/private-mode.md).
# Exit status: 0 = no FAIL findings, 1 = FAIL findings, 2 = usage error / nothing to scan.
# =====================================================================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WEB_DIR="$ROOT/apps/web/.next"
API_DIR="$ROOT/apps/api/dist"
EXTRA_ALLOW=()
INCLUDE_NM=0
REQUIRE_WEB=0

while [ $# -gt 0 ]; do
  case "$1" in
    --web-dir) WEB_DIR="$2"; shift 2 ;;
    --api-dir) API_DIR="$2"; shift 2 ;;
    --allow) EXTRA_ALLOW+=("$2"); shift 2 ;;
    --include-node-modules) INCLUDE_NM=1; shift ;;
    --require-web) REQUIRE_WEB=1; shift ;;
    -h|--help) sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "egress-check: unknown argument $1" >&2; exit 2 ;;
  esac
done

# Reference-only URL prefixes (scheme stripped). Keep this list short and justified.
ALLOW=(
  "www.w3.org/"                 # XML / SVG / MathML / XLink namespace identifiers
  "json-schema.org/"            # JSON Schema $schema identifiers (zod toJSONSchema)
  "react.dev/errors/"           # React production error-decoder links in messages (not fetched)
  "reactjs.org/docs/error-decoder" # older React error-decoder link format
  "nextjs.org/docs/"            # Next.js error/warning documentation links (not fetched)
  "localhost" "127.0.0.1" "0.0.0.0" "[::1]"
  "example.com" "example.org" "example.net" "example.invalid" "demo.invalid"  # RFC 2606 / RFC 6761 names
)
IFS=',' read -r -a ENV_ALLOW <<<"${HUB_EGRESS_ALLOWLIST:-}"
for h in "${ENV_ALLOW[@]+"${ENV_ALLOW[@]}"}" "${EXTRA_ALLOW[@]+"${EXTRA_ALLOW[@]}"}"; do
  h="$(printf '%s' "$h" | tr -d '[:space:]')"; [ -n "$h" ] && ALLOW+=("$h")
done

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
: >"$TMP/findings"
URL_RE="https?://[A-Za-z0-9.-]+(:[0-9]+)?[A-Za-z0-9._~%/?#@!\$&'()*+,;=:-]*"

allowed() {
  local u="${1#http://}"; u="${u#https://}"
  local a
  for a in "${ALLOW[@]}"; do
    case "$u" in "$a"*|*".$a"|*".$a/"*|*".$a:"*) return 0 ;; esac
  done
  return 1
}

# True when file $1 references URL $2 in a construct the browser fetches AUTOMATICALLY: CSS url()/@import, src /
# srcset attributes (HTML or compiled JSX props), or a <link> element (stylesheet/preconnect/preload/icon). Plain
# <a href> links are navigations a user must click; they are reported as WARN for review.
fetchable() {
  local f="$1" u="$2"
  grep -qF -e "url($u" -e "url(\"$u" -e "url('$u" -e "@import \"$u" -e "@import '$u" \
    -e "src=\"$u" -e "src=\\\"$u" -e "src:\"$u" -e "srcset=\"$u" -e "srcSet:\"$u" "$f" 2>/dev/null && return 0
  { grep -oE '<link[^>]*>' "$f" 2>/dev/null || true; } | grep -qF "$u" && return 0
  { grep -oE '"link",\{[^}]*\}' "$f" 2>/dev/null || true; } | grep -qF "$u" && return 0
  return 1
}

# scan <label> <dir> <find-expression...>
scan() {
  local label="$1" dir="$2"; shift 2
  [ -d "$dir" ] || return 0
  local prune=(-path '*/node_modules' -prune -o)
  [ "$INCLUDE_NM" = 1 ] && prune=()
  local nfiles
  nfiles=$(find "$dir" "${prune[@]}" -type f \( "$@" \) -print | tee "$TMP/files.$label" | wc -l | tr -d ' ')
  echo "scanning $label: $dir ($nfiles files)"
  while IFS= read -r f; do
    { grep -oE "$URL_RE" "$f" 2>/dev/null || true; } | sed -E "s/[)'\",;]+$//" | sort -u | while IFS= read -r u; do
      allowed "$u" && continue
      local sev="WARN"
      case "$label" in
        api|web-css) sev="FAIL" ;;
        web-html|web-js) fetchable "$f" "$u" && sev="FAIL" ;;
      esac
      printf '%s\t%s\t%s\t%s\n' "$sev" "$label" "${f#"$ROOT"/}" "$u" >>"$TMP/findings"
    done
  done <"$TMP/files.$label"
}

SCANNED=0
if [ -d "$WEB_DIR" ]; then
  SCANNED=1
  # Scan what is shipped (static assets, server output, standalone server); skip caches, dev output and build-time
  # chunks (.next/build, .next/diagnostics), which are not copied into the image.
  SKIP=(-not -path '*/cache/*' -not -path '*/dev/*' -not -path "$WEB_DIR/build/*" -not -path "$WEB_DIR/diagnostics/*")
  scan web-css "$WEB_DIR" -name '*.css' "${SKIP[@]}"
  scan web-html "$WEB_DIR" \( -name '*.html' -o -name '*.rsc' -o -name '*.body' \) "${SKIP[@]}"
  scan web-js "$WEB_DIR" \( -name '*.js' -o -name '*.mjs' -o -name '*.json' \) -not -name '*.map' "${SKIP[@]}"
else
  echo "web build not found at $WEB_DIR (build apps/web first to include it)"
  [ "$REQUIRE_WEB" = 1 ] && { echo "egress-check: --require-web given but no web build" >&2; exit 2; }
fi
if [ -d "$API_DIR" ]; then
  SCANNED=1
  scan api "$API_DIR" \( -name '*.js' -o -name '*.json' \) -not -name '*.map'
else
  echo "api build not found at $API_DIR"
fi
[ "$SCANNED" = 1 ] || { echo "egress-check: nothing to scan" >&2; exit 2; }

FAILS=$(awk -F'\t' '$1 == "FAIL"' "$TMP/findings" | wc -l | tr -d ' ')
WARNS=$(awk -F'\t' '$1 == "WARN"' "$TMP/findings" | wc -l | tr -d ' ')
echo
echo "allowlist (reference-only + approved): ${ALLOW[*]}"
if [ -s "$TMP/findings" ]; then
  echo
  echo "Findings (severity, category, file, url) — unique per file:"
  sort -u "$TMP/findings" | sort -t$'\t' -k1,1 -k4,4 | awk -F'\t' '{ printf "%-4s  %-8s  %s\n      %s\n", $1, $2, $3, $4 }'
  echo
  echo "Distinct non-allowlisted hosts:"
  awk -F'\t' '{ print $1 "\t" $4 }' "$TMP/findings" | sed -E 's#\t(https?://[^/:?#]+).*#\t\1#' | sort | uniq -c | sort -rn
fi
echo
echo "RESULT: $FAILS FAIL, $WARNS WARN"
[ "$FAILS" = 0 ]
