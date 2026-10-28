#!/bin/sh
# Regenerate data/bench.json and commit it if it changed.
# Usage: tools/refresh.sh [--push] [csv] [repo]   (or set MEITOU_CSV, MEITOU_REPO)
set -eu
PUSH=0
if [ "${1:-}" = "--push" ]; then PUSH=1; shift; fi
CSV="${1:-${MEITOU_CSV:-}}"
REPO="${2:-${MEITOU_REPO:-}}"
[ -n "$CSV" ] && [ -n "$REPO" ] || { echo "usage: $0 [--push] CSV REPO (or MEITOU_CSV / MEITOU_REPO)" >&2; exit 2; }
cd "$(dirname "$0")/.."
python3 tools/generate.py --csv "$CSV" --repo "$REPO"
git add data
if git diff --cached --quiet -- data; then
  echo "data unchanged"
else
  git commit -q -m "Update benchmark data" -- data
  echo "committed"
fi
if [ "$PUSH" = 1 ]; then git push; fi
