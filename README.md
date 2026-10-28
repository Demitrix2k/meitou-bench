# Meitou daily benchmarks

A small static site that publishes daily performance benchmarks of
[Meitou](https://github.com/VlcekM/MeitouClient) (a C#/.NET Vulkan reimplementation of the game Kenshi),
together with a summary of the upstream changes between benchmarked commits.

Not affiliated with Lo-Fi Games or Kenshi's makers. Meitou is a separate project.

## How the numbers are made

After each upstream `master` update, one fixed benchmark is run by the maintainer of this page:

- native Linux build of upstream `master`
- clean, unmodded game data (GOG copy)
- the same frozen save every run (two player bases; never played or saved over)
- full graphics settings
- MangoHud frame-time logging; frame metrics come from the game's bench frames
- machine: laptop with an RTX 3070 Laptop GPU, 14 GB RAM, Linux (GPU and driver version are recorded per row)

Two scenarios: the play benchmark (upstream's own `--play-bench`, camera segments idle, orbit, zoom, pan) and a
base switch (four camera jumps between the two bases). Metrics: share of frames over 33 ms, p50 / p99 / max frame
time, frames over 100 ms, and the game's own slow simulation-tick timings ("slow world" p99 / max).
Lower is better for all of them.

## Runs and series

Within one commit, scenario and machine, rows are ordered by date and time: that order is run 1, run 2, ... Runs are
shown with separate markers and never averaged together.

Series are defined by hand in `series.json`. A series is a stretch of time in which the procedure was the same:

- Series 1 (from 2026-10-27 09:52:28): one run per scenario.
- Series 2 (from 2026-10-28 07:34:17): two runs per scenario, back-to-back. Run 1 may be cache-cold (disk cache,
  shader cache), run 2 warm.

Charts draw a vertical line where a series starts.

## Change summaries

For each benchmarked commit, `tools/generate.py` reads the upstream git history between it and the previous benchmarked
commit (`git log --no-merges prev..cur`, plus merge commits for the list of merged pull requests) and groups commit
subjects into buckets by the text before the first colon (mapping in `series.json`; unknown prefixes go to Other).
Summaries are taken from upstream commit messages only and are not reviewed. The first benchmarked commit has no list.

## Regenerating

```
python3 tools/generate.py --csv path/to/daily-bench.csv --repo path/to/MeitouClient
```

`--repo` is a clone of the upstream repository; it is only read. The script is deterministic, so rerunning it after
new CSV rows is safe. `tools/refresh.sh` runs it (paths as arguments or `MEITOU_CSV` / `MEITOU_REPO`) and commits
`data/` if it changed; it only pushes when called with `--push`.

Preview locally (the page loads `data/bench.json`, so open it over http, not `file://`):

```
python3 -m http.server 8765 --bind 127.0.0.1
```

## Data format

`data/bench.json` has `machines`, `series`, `scenarios`, `buckets`, `commits` (benchmark order, with the change lists)
and `rows`. A row has: `date`, `time`, `commit`, `commit_full`, `scenario` (`play` or `bases`), `run`, `metrics`,
`gpu`, `driver`, `machine`, `series`, `note`.

The input CSV needs these columns: `date,time,commit,segments,frames_over_33ms_pct,p50_ms,p99_ms,max_ms,frames_over_100ms,slow_world_p99_ms,slow_world_max_ms,gpu,nvidia_driver,note`
(other columns are ignored and never published). To add another machine, add an optional `machine` column holding an
id and describe that id under `machines` in `series.json`; rows without it get `default_machine`. The page then shows a
machine selector.

## License

License: to be decided.
