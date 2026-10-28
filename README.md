# Meitou benchmarks

The public home for Meitou benchmarks from several machines. Meitou is a C#/.NET Vulkan reimplementation of the game
Kenshi ([upstream](https://github.com/VlcekM/MeitouClient)). This repository holds three things:

- `kit/`: the dev kit. Reproduces the fixed benchmark on your own machine (see `kit/README.md`).
- `data/`: results. `data/machines/<id>.json` describes a machine, `data/results/<id>/` holds its result CSVs.
  Contributors add their own files by pull request (see `CONTRIBUTING.md`).
- the page: `index.html`, `assets/`, built from the data by `tools/generate.py`. It shows, per machine, trend charts per
  benchmarked upstream commit, comparisons between machines, a coverage matrix of machines against targets, and a summary of
  upstream changes between benchmarked commits.

Not affiliated with Lo-Fi Games or Kenshi's makers. Meitou is a separate project.

## The standard

`targets.json` is the ordered list of benchmark targets (commit, date, label, kind `release` or `daily`). The latest entry is the
current standard: everyone benchmarks it, so numbers from different machines are comparable. Release targets (e.g. `v0.16.0`) are
anchor points every machine should run at least once. A commit that differs from a target only in `docs/`, `site/`, `tests/`,
`.github/`, `tools/` or `*.md` is code-identical and counts for it; any other commit is accepted but flagged off-target (faded on
the page, left out of comparisons between machines). The kit builds the latest target by default.

## How the numbers are made

After each upstream `master` update, the maintainer runs one fixed benchmark (contributors run the same one with the kit):

- native Linux build of upstream `master`
- clean, unmodded game data (GOG copy)
- the same frozen save every run (two player bases; never played or saved over)
- full graphics settings
- MangoHud frame-time logging; frame metrics come from the game's bench frames
- machine: described in `data/machines/<id>.json` (GPU, driver, CPU, RAM, OS and render resolution are recorded; the maintainer's is a laptop with an RTX 3070 Laptop GPU, 14 GB RAM, Linux, 2560x1406)

Two scenarios: the play benchmark (upstream's own `--play-bench`, camera segments idle, orbit, zoom, pan) and a
base switch (four camera jumps between the two bases). Metrics: share of frames over 33 ms, p50 / p99 / max frame
time, frames over 100 ms, and the game's own slow simulation-tick timings ("slow world" p99 / max).
Lower is better for all of them.

## Data layout

```
targets.json                                   benchmark targets, oldest first
data/machines/<machine-id>.json                id, github, name (optional), cpu, gpu, ram_gb, os, resolution, notes, added
data/results/<machine-id>/<date>-<commit>.csv  the kit's results.csv as written (19 columns, or 25 with machine columns)
data/results/<machine-id>/<date>-<commit>.report.md   optional
data/results/rtx3070-laptop-linux/daily-bench.csv     the maintainer's file (19 columns; machine comes from the folder)
```

`data/bench.json` is generated (by `tools/generate.py`, and in CI); it is gitignored and not committed. Its rows have: `date`,
`time`, `commit`, `commit_full`, `scenario` (`play` or `bases`), `run`, `metrics`, `gpu`, `driver`, `machine`, `platform`,
`target` (the target the commit counts for, or null), `series`, `note`.

Commits are ordered by upstream history (`git rev-list --topo-order origin/master`), not by date. A commit that is not on upstream
`master` is rejected. "Changes between benchmarks" are computed between consecutive benchmarked commits across all machines.

## Series

Series are defined by hand in `series.json` and apply to the maintainer machine by time; contributor rows whose note starts with
`series 2` (the kit's note) count as series 2:

- Series 1 (from 2026-10-27 09:52:28): one run per scenario.
- Series 2 (from 2026-10-28 07:34:17): two runs per scenario, back-to-back. Run 1 may be cache-cold (disk cache, shader cache),
  run 2 warm.

Charts draw a vertical line where a series starts. Runs are numbered per machine, commit and scenario by time and are never averaged.

## Change summaries

For each benchmarked commit, `tools/generate.py` reads the upstream git history between it and the previous benchmarked commit
(`git log --no-merges prev..cur`, plus merge commits for the list of merged pull requests) and groups commit subjects into
buckets by the text before the first colon (mapping in `series.json`; unknown prefixes go to Other). Summaries are taken from
upstream commit messages only and are not reviewed.

## Building the page locally

```
git clone --filter=blob:none https://github.com/VlcekM/MeitouClient upstream   # read only, only needed for git history
python3 tools/generate.py --repo upstream            # validates everything, writes data/bench.json
python3 tools/generate.py --repo upstream --check    # validate only (what CI runs on pull requests)
python3 -m http.server 8765 --bind 127.0.0.1         # the page loads data/bench.json, so use http, not file://
```

`--repo` is a clone of the upstream repository (any existing clone works); `--ref` (default `origin/master`) defines the order.
Invalid input prints every problem and exits non-zero. Off-target commits print a warning only.

## CI

- `.github/workflows/check.yml` (pull requests): fails if a PR touches anything outside `data/machines/` and `data/results/`
  (unless the author is the repository owner), then runs `generate.py --check` against a fresh clone of upstream.
- `.github/workflows/pages.yml` (push to `main`): clones upstream, runs the generator and deploys the site with GitHub Pages.

## For the maintainer

After an upstream update and a benchmark run:

```
tools/refresh.sh [--push] <daily-bench.csv> <path to an updated MeitouClient clone>
```

It copies the maintainer CSV to `data/results/rtx3070-laptop-linux/daily-bench.csv`, validates, appends a new daily target to
`targets.json` when the newly benchmarked commit is not code-identical to the latest target (it becomes the new standard),
and commits both. It never touches the upstream clone and only pushes with `--push`. Release targets are added to `targets.json`
by hand (kind `release`, label = the upstream tag; the generator checks the tag against the commit).

## License

License: to be decided.
