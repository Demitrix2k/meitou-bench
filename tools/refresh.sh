#!/bin/sh
# Maintainer: copy the maintainer's daily-bench.csv into the data folder, validate, and commit if it changed.
# Usage: tools/refresh.sh [--push] [csv] [repo]   (or set MEITOU_CSV, MEITOU_REPO)
#   csv  = the maintainer's 19-column daily-bench.csv, copied to data/results/rtx3070-laptop-linux/daily-bench.csv
#   repo = a clone of upstream MeitouClient, already updated (never touched by this script; its origin/master defines commit order)
# A newer benchmarked commit that is not code-identical to the latest target is appended to targets.json as a daily target (it becomes the new standard).
# data/bench.json is generated for local preview only and is not committed (CI builds it).
# Pushes only with --push.
set -eu
PUSH=0
if [ "${1:-}" = "--push" ]; then PUSH=1; shift; fi
CSV="${1:-${MEITOU_CSV:-}}"
REPO="${2:-${MEITOU_REPO:-}}"
[ -n "$CSV" ] && [ -n "$REPO" ] || { echo "usage: $0 [--push] CSV REPO (or MEITOU_CSV / MEITOU_REPO)" >&2; exit 2; }
cd "$(dirname "$0")/.."
DEST=data/results/rtx3070-laptop-linux/daily-bench.csv
cp "$CSV" "$DEST"
if ! python3 tools/generate.py --repo "$REPO" --append-targets; then
  git checkout -q -- "$DEST" 2>/dev/null || true
  echo "validation failed; $DEST restored" >&2
  exit 1
fi
git add "$DEST" targets.json
if git diff --cached --quiet -- "$DEST" targets.json; then
  echo "data unchanged"
else
  git commit -q -m "Update maintainer benchmark data" -- "$DEST" targets.json
  echo "committed"
fi
if [ "$PUSH" = 1 ]; then git push; fi
