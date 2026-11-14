#!/usr/bin/env bash
# image-bundle.sh: the image set of a release as one file set, for a host without registry access (ADR-0069 §6;
# p7-work-split §B.3; T-DG7-DO-E; REQ-S19-018 "the image set loads on a host without registry access").
#
#   deploy/scripts/image-bundle.sh save   --out <dir>  [--app-image <ref>]   (on a CONNECTED host)
#   deploy/scripts/image-bundle.sh load   --from <dir>                      (on the target host)
#   deploy/scripts/image-bundle.sh verify --from <dir>                      (on either host, after load)
#
# save   For every image of deploy/images.lock.json THAT A COMPOSE FILE RUNS (an entry of its `usedIn` is a file under
#        deploy/compose/; ADR-0069 §6 as amended by A1.3), by its pinned reference <ref>:<tag>@<digest> (the reference
#        Compose uses), and for the locally built application image (deploy/scripts/build-image.sh; default
#        ${MTH_APP_IMAGE:-mth-app:local}, the Compose default): read its image id and size with `docker image inspect`,
#        then write ONE `docker save` archive images.tar and images.json (strict UTF-8 JSON, schemaVersion
#        mth-image-bundle/1): per image the name, the lock id and digest (null for the app image), the image id, the size,
#        and the tar SHA-256. The lock images that no Compose file runs (on the current lock the CI-only `playwright`, and
#        `node-runtime`, whose layers travel inside mth-app) are listed in the optional key `excluded`
#        ([{ lockId, reason }]) and are never saved. A bundled lock image with no digest, or an image that is not present
#        locally, is BLOCKED (exit 2): this script never pulls. Pull on the connected host first (`docker compose pull`).
# load   Check images.tar's size and SHA-256 against images.json BEFORE any docker call (a changed tar exits 1 and
#        `docker load` is never called), then `docker load -i images.tar`, then compare each `docker image inspect` id
#        with images.json (a mismatch exits 1).
#        Image store (ADR-0069 A1.2): before any id check, load and verify read `docker info` and exit 3 unless the
#        engine uses the containerd image store (driver-type io.containerd.snapshotter.v1). The classic store does not
#        restore the registry digest on load, so the digest-pinned names of images.json and Compose cannot resolve.
#        The script never re-tags an image and never rewrites an `image:` line.
# verify The same two checks without loading: the tar against images.json, and every listed image present locally with
#        its recorded id.
#
# No path ever runs `docker pull`, `docker login` or `docker push`. The registry-free proof is the orchestrator's (ADR-0069
# §6): remove the images, `load`, then `docker compose ... up --pull never --wait`, which fails if any image is missing
# locally. A load on a host that otherwise has registry access is not a physically air-gapped host (ADR-0069 residual 5),
# and a Compose start is not evidence of high-availability production readiness.
#
# Exit codes (p7-work-split §2 rule 4): 0 PASS; 1 FAIL (a mismatch); 2 BLOCKED (usage, missing or invalid input, an
# image not present locally); 3 BLOCKED (no Docker daemon reachable, or the classic image store on load/verify).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
LOCK="${MTH_IMAGES_LOCK:-$REPO/deploy/images.lock.json}"
CMD="${1:-}"
[ $# -gt 0 ] && shift
OUT="" FROM="" APP_IMAGE="${MTH_APP_IMAGE:-mth-app:local}"
usage() {
  echo "image-bundle: BLOCKED: usage: image-bundle.sh save --out <dir> [--app-image <ref>] | load --from <dir> | verify --from <dir>" >&2
  exit 2
}
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="${2:-}"; shift 2 ;;
    --from) FROM="${2:-}"; shift 2 ;;
    --app-image) APP_IMAGE="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
case "$CMD" in
  save) [ -n "$OUT" ] && [ -z "$FROM" ] && [ -n "$APP_IMAGE" ] || usage ;;
  load | verify) [ -n "$FROM" ] && [ -z "$OUT" ] || usage ;;
  *) usage ;;
esac

log() { echo "image-bundle: $*"; }
need_daemon() {
  if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
    echo "image-bundle: BLOCKED: docker daemon not reachable"
    exit 3
  fi
}
# need_containerd_store: ADR-0069 A1.2. The containerd image store reports driver-type io.containerd.snapshotter.v1 in
# `docker info`'s DriverStatus; any other store (overlay2 and the other graph drivers) is the classic one.
need_containerd_store() {
  local driver status
  driver="$(docker info --format '{{.Driver}}' 2>/dev/null || true)"
  status="$(docker info --format '{{json .DriverStatus}}' 2>/dev/null || true)"
  if [[ "$status" != *'"driver-type","io.containerd.snapshotter.v1"'* ]]; then
    log "image store: classic (storage driver '${driver:-unknown}', DriverStatus ${status:-unknown})"
    echo "image-bundle: BLOCKED: the classic image store cannot resolve digest references after load (ADR-0069 A1.2); enable the containerd image store"
    exit 3
  fi
  log "image store: containerd (storage driver '$driver', driver-type io.containerd.snapshotter.v1)"
}
sha_of() { sha256sum "$1" | cut -d' ' -f1; }

# check_tar <dir>: images.json is well formed and images.tar matches its recorded size and SHA-256. No docker call.
check_tar() {
  local dir="$1"
  [ -f "$dir/images.json" ] || { echo "image-bundle: BLOCKED: $dir/images.json not found" >&2; exit 2; }
  [ -f "$dir/images.tar" ] || { echo "image-bundle: BLOCKED: $dir/images.tar not found" >&2; exit 2; }
  local want
  want="$(node -e '
    const fs = require("node:fs");
    let m;
    try { m = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(process.argv[1]))); }
    catch (e) { console.error("image-bundle: BLOCKED: images.json is not strict UTF-8 JSON: " + e.message); process.exit(2); }
    const ok = m && m.schemaVersion === "mth-image-bundle/1" && m.tar && /^[0-9a-f]{64}$/.test(m.tar.sha256) &&
      Number.isInteger(m.tar.bytes) && Array.isArray(m.images) && m.images.length > 0 &&
      m.images.every((i) => typeof i.name === "string" && /^sha256:[0-9a-f]{64}$/.test(i.imageId) && i.tarSha256 === m.tar.sha256);
    if (!ok) { console.error("image-bundle: BLOCKED: images.json is not an mth-image-bundle/1 manifest"); process.exit(2); }
    console.log(m.tar.bytes + " " + m.tar.sha256);' "$dir/images.json")" || exit 2
  local bytes="${want% *}" sha="${want#* }"
  if [ "$(stat -c %s "$dir/images.tar")" != "$bytes" ]; then
    echo "image-bundle: images.tar does not match images.json (bytes)"
    exit 1
  fi
  if [ "$(sha_of "$dir/images.tar")" != "$sha" ]; then
    echo "image-bundle: images.tar does not match images.json (sha256)"
    exit 1
  fi
  log "images.tar matches images.json: $bytes bytes, sha256 $sha"
}

# check_ids <dir>: every image of images.json is present locally with its recorded id.
check_ids() {
  local dir="$1" name want got bad=0
  while IFS=$'\t' read -r name want; do
    got="$(docker image inspect --format '{{.Id}}' "$name" 2>/dev/null || true)"
    if [ -z "$got" ]; then
      echo "image-bundle: $name does not match images.json (present)"
      bad=1
    elif [ "$got" != "$want" ]; then
      echo "image-bundle: $name does not match images.json (imageId)"
      bad=1
    else
      log "$name: image id $got as recorded"
    fi
  done < <(node -e 'for (const i of JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).images)
    console.log(i.name + "\t" + i.imageId)' "$dir/images.json")
  [ "$bad" -eq 0 ] || exit 1
}

case "$CMD" in
  save)
    [ -f "$LOCK" ] || { echo "image-bundle: BLOCKED: $LOCK not found" >&2; exit 2; }
    # ADR-0069 A1.3: the lock images that a Compose file runs are bundled; the others go to `excluded` (node prints
    # them as one last line `excluded<TAB><json>`). A bundled reference must be pinned (a null digest means NOT PINNED;
    # it is never bundled). No temporary file, so the script needs no writable TMPDIR.
    # Capture node's output first: `mapfile < <(node ...) || exit` would test mapfile's status, not node's.
    LOCKED_TSV="$(node -e '
      const fs = require("node:fs");
      const l = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      let bad = 0;
      const excluded = [];
      for (const i of l.images) {
        const usedIn = Array.isArray(i.usedIn) ? i.usedIn : [];
        if (!usedIn.some((f) => typeof f === "string" && f.startsWith("deploy/compose/"))) {
          excluded.push({ lockId: i.id, reason: "not run by any Compose file (usedIn: " + (usedIn.join(", ") || "none") + ")" });
          continue;
        }
        if (!/^sha256:[0-9a-f]{64}$/.test(i.digest ?? "")) { console.error("image-bundle: BLOCKED: " + i.id + " has no pinned digest in images.lock.json"); bad = 1; continue; }
        console.log([i.id, i.digest, i.ref + ":" + i.tag + "@" + i.digest].join("\t"));
      }
      console.log("excluded\t" + JSON.stringify(excluded));
      process.exit(bad ? 2 : 0);' "$LOCK")" || exit 2
    EXCLUDED_JSON="$(printf '%s\n' "$LOCKED_TSV" | sed -n 's/^excluded\t//p')"
    LOCKED=()
    while IFS= read -r row; do
      case "$row" in excluded$'\t'*) ;; ?*) LOCKED+=("$row") ;; esac
    done <<<"$LOCKED_TSV"
    [ "${#LOCKED[@]}" -gt 0 ] || { echo "image-bundle: BLOCKED: images.lock.json lists no image that a Compose file runs" >&2; exit 2; }
    node -e 'for (const e of JSON.parse(process.argv[1])) console.log("image-bundle: excluded " + e.lockId + ": " + e.reason)' \
      "$EXCLUDED_JSON"
    need_daemon
    mkdir -p "$OUT"
    OUT="$(cd "$OUT" && pwd)"
    ROWS="$OUT/.images.tsv"
    : >"$ROWS"
    NAMES=()
    for row in "${LOCKED[@]}" "$(printf 'app	-	%s' "$APP_IMAGE")"; do
      IFS=$'\t' read -r id digest name <<<"$row"
      meta="$(docker image inspect --format '{{.Id}} {{.Size}}' "$name" 2>/dev/null || true)"
      if [ -z "$meta" ]; then
        echo "image-bundle: BLOCKED: $name is not present locally; this script never pulls (pull or build it on the connected host first)" >&2
        rm -f "$ROWS"
        exit 2
      fi
      printf '%s\t%s\t%s\t%s\t%s\n' "$id" "$digest" "$name" "${meta% *}" "${meta#* }" >>"$ROWS"
      NAMES+=("$name")
      log "$name: image id ${meta% *}"
    done
    rm -f "$OUT/images.tar" "$OUT/images.json"
    docker save -o "$OUT/images.tar" "${NAMES[@]}"
    [ -s "$OUT/images.tar" ] || { echo "image-bundle: docker save wrote no images.tar"; rm -f "$ROWS"; exit 1; }
    node -e '
      const fs = require("node:fs");
      const [rows, tar, sha, lock, out, excludedJson] = process.argv.slice(1);
      const images = fs.readFileSync(rows, "utf8").trim().split("\n").map((l) => {
        const [id, digest, name, imageId, size] = l.split("\t");
        if (!/^sha256:[0-9a-f]{64}$/.test(imageId)) { console.error("image-bundle: " + name + " has no image id (" + imageId + ")"); process.exit(1); }
        return { name, lockId: id === "app" ? null : id, lockDigest: digest === "-" ? null : digest, imageId,
          size: /^[0-9]+$/.test(size) ? Number(size) : null, tarSha256: sha };
      });
      const m = { schemaVersion: "mth-image-bundle/1", createdAt: new Date().toISOString(),
        lockSha256: require("node:crypto").createHash("sha256").update(fs.readFileSync(lock)).digest("hex"),
        tar: { file: "images.tar", bytes: fs.statSync(tar).size, sha256: sha }, images,
        excluded: JSON.parse(excludedJson) };
      fs.writeFileSync(out, JSON.stringify(m, null, 2) + "\n");' \
      "$ROWS" "$OUT/images.tar" "$(sha_of "$OUT/images.tar")" "$LOCK" "$OUT/images.json" "$EXCLUDED_JSON"
    rm -f "$ROWS"
    log "saved ${#NAMES[@]} images: $OUT/images.tar ($(stat -c %s "$OUT/images.tar") bytes, sha256 $(sha_of "$OUT/images.tar")); manifest $OUT/images.json"
    ;;
  load)
    FROM="$(cd "$FROM" 2>/dev/null && pwd)" || { echo "image-bundle: BLOCKED: bundle directory not found" >&2; exit 2; }
    check_tar "$FROM"
    need_daemon
    need_containerd_store
    docker load -i "$FROM/images.tar"
    check_ids "$FROM"
    log "PASS: load: every image of images.json is present with its recorded id"
    ;;
  verify)
    FROM="$(cd "$FROM" 2>/dev/null && pwd)" || { echo "image-bundle: BLOCKED: bundle directory not found" >&2; exit 2; }
    check_tar "$FROM"
    need_daemon
    need_containerd_store
    check_ids "$FROM"
    log "PASS: verify: images.tar matches images.json and every image is present with its recorded id"
    ;;
esac
