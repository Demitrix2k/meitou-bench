#!/usr/bin/env bash
# verify-save.sh: check a benchmark save folder against save-checksums.sha256 (same files, same SHA-256 each). Read-only.
# Usage: verify-save.sh <save folder>      Exit 0 if it matches, 1 if not, 2 on bad usage.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dir="${1:-}"; [ -d "$dir" ] || { echo "usage: verify-save.sh <save folder>" >&2; exit 2; }
sums="$here/save-checksums.sha256"; [ -f "$sums" ] || { echo "verify-save.sh: $sums missing" >&2; exit 2; }
cd "$dir"
if ! sha256sum --check --quiet "$sums"; then echo "MISMATCH: files differ or are missing (see above)" >&2; exit 1; fi
have="$(find . -type f | wc -l)"; want="$(wc -l < "$sums")"
[ "$have" = "$want" ] || { echo "MISMATCH: $have files in the folder, $want in the manifest" >&2; exit 1; }
echo "OK: $have files match save-checksums.sha256"
