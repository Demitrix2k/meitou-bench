#!/bin/sh
# Maintainer: copy the maintainer's daily-bench.csv into the data folder, validate, and commit if it changed.
# Usage: tools/refresh.sh [--push] [csv] [repo]   (or set MEITOU_CSV, MEITOU_REPO)
#   csv  = the maintainer's 19-column daily-bench.csv, copied to data/results/rtx3070-laptop-linux/daily-bench.csv
#   repo = a clone of upstream MeitouClient, already updated (never touched by this script; its origin/master defines commit order)
# targets.json is a copy of upstream's bench/targets.json from origin/master of the repo (upstream's workflow keeps it); it is overwritten on every run, never appended to locally.
# data/bench.json is generated for local preview only and is not committed (CI builds it).
# Pushes only with --push.
set -eu
PUSH=0
if [ "${1:-}" = "--push" ]; then PUSH=1; shift; fi
CSV="${1:-${MEITOU_CSV:-}}"
REPO="${2:-${MEITOU_REPO:-}}"
[ -n "$CSV" ] && [ -n "$REPO" ] || { echo "usage: $0 [--push] CSV REPO (or MEITOU_CSV / MEITOU_REPO)" >&2; exit 2; }
cd "$(dirname "$0")/.."
# Merged contributor PRs land on main: start from it, so the push is a fast-forward.
if [ "$PUSH" = 1 ]; then git pull -q --rebase; fi
DEST=data/results/rtx3070-laptop-linux/daily-bench.csv
cp "$CSV" "$DEST"
restore() { git checkout -q -- "$DEST" targets.json 2>/dev/null || true; }
if ! git -C "$REPO" show origin/master:bench/targets.json > targets.json.new 2>/dev/null || [ ! -s targets.json.new ]; then
  rm -f targets.json.new; restore
  echo "$REPO has no bench/targets.json on origin/master (fetch it first); nothing changed" >&2
  exit 1
fi
mv targets.json.new targets.json
if ! python3 tools/generate.py --repo "$REPO"; then
  restore
  echo "validation failed; $DEST and targets.json restored" >&2
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
