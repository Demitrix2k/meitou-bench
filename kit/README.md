# Meitou benchmark dev kit

Reproduce the Meitou daily benchmark on your own machine and report in a common format, so numbers from different machines and commits can be compared.

## What it measures, and why it is comparable

Meitou is a C#/.NET 10 Vulkan reimplementation of Kenshi (upstream: github.com/VlcekM/MeitouClient). The maintainers run one fixed benchmark after every update of upstream master. This kit runs the same one:

- **Play benchmark** (the game's own `--play-bench`): after a `settle` step that is not counted, the segments `idle`, `orbit`, `zoom`, `pan` (about 44 s). Reports frame-time statistics and the slow-world simulation tick.
- **Base switch** (`bases` scenario): the segments `idle` and `return` (10 s each); 1 s and 6 s into each, the script double-taps `2` then `1`, which centres the camera on the character at base 2, then at base 1. Four switches; it measures streaming and drawing of the other base.

Everything that could differ is fixed: the frozen save `bench-bases-2026-10-27`, clean Kenshi data (no mods), the settings file in this kit, windowed mode with full settings (never `--low-end`), MangoHud logging, two runs of each scenario back-to-back. What stays machine dependent is the hardware, and the window size: the game opens windowed at the size of your desktop, and the resolution is recorded with every row. Compare like with like (same resolution).

Total game time is about 8 minutes (plus about 35 s of loading per run).

## Prerequisites

- Linux with a graphical session (see "Windows / Proton" for the rest), `bash` 4.4 or newer, `git`, `python3`, `curl`/`unzip` for the save.
- The .NET 10 SDK (`dotnet --list-sdks` shows a `10.x`).
- MangoHud (`mangohud` on PATH).
- `ydotool` and its daemon `ydotoold`, with write access to `/dev/uinput`. Only the base-switch scenario needs them: it sends the keys to the game window, which must keep focus. Without ydotool, run `--scenarios play` only.
- A Kenshi install with clean data: no mods installed or active (a fresh GOG or Steam install is fine). Its folder holds `data/` and `save/`; this is `KENSHI_PATH` below.
- Optional for the hardware record: `nvidia-smi`, `vulkaninfo`, `xrandr`. Missing ones give "unknown" (override with env vars, see `lib.sh`).
- About 6 GB free RAM and 1 GB disk (a copy of the save is made).

## Steps

1. Get the kit. Copy this `dev-kit` folder somewhere and enter it.

```bash
cd dev-kit
chmod +x *.sh
```

2. Tell the scripts where your Kenshi is, and name your machine.

```bash
export KENSHI_PATH="$HOME/path/to/Kenshi"      # the folder with data/ and save/
export MACHINE="mylaptop-rtx3060"              # a short label for your report
export WHO="your name or handle"
```

3. Get the benchmark save. Download `bench-bases-2026-10-27.zip` (the save zip attached to this repo's GitHub release; link to be added: <LINK TBD>) and unzip it into `<Kenshi>/save/`. The script verifies the folder against `save-checksums.sha256` (every file's SHA-256 and the file count) before use, and refuses on a mismatch. You can check by hand:

```bash
unzip bench-bases-2026-10-27.zip -d "$KENSHI_PATH/save/"
./verify-save.sh "$KENSHI_PATH/save/bench-bases-2026-10-27"
```

   The checksum of `save-checksums.sha256` itself, which goes into your report: `ceb2fb186fcfce7d3841a947914eac89f37547b028fbf05fb760aa8613dac4ff`. The script never writes into the save: it copies it into the output folder and the game loads the copy.

4. Build the current benchmark target (native Linux). Everyone benchmarks the same commits: `update-and-build.sh` reads `targets.json` (the latest entry is the current standard; from the public repository, or `../targets.json` when offline) and builds that commit. `REF=origin/master` or any other commit still works but prints a warning: the result is then off-target (accepted, but flagged and left out of cross-machine comparisons). `bench.sh` says in its output and report whether the commit is a target. The first run clones `https://github.com/VlcekM/MeitouClient.git` into `./MeitouClient`; later runs fetch. Your own working tree is never touched. The build goes to `./builds/Meitou-master-linux` and gets the kit's `meitou.user.json`.

```bash
./update-and-build.sh native
```

   Options (env): `MEITOU_SRC` (an existing clone), `DOTNET_ROOT` (SDK not on PATH), `MEMORY_MAX=6G`, `REF=<commit>` (benchmark something else), `FORCE=1`. For the Windows build: `./update-and-build.sh windows` (or `both`).

5. The settings file. `update-and-build.sh` installs `meitou.user.json` from this kit into the build. If you built some other way, copy it yourself:

```bash
cp meitou.user.json builds/Meitou-master-linux/meitou.user.json
```

   It holds the maintainers' benchmark settings (TAA, texture quality 1, frame limit 90, characters' flights off, ...). `bench.sh` checks that the build's file still has all of its values (the game adds keys of its own on start) and refuses otherwise; do not edit it for a comparable run.

6. Run the benchmark. Check first without starting the game (optional), then run. Do not use the mouse or keyboard in other windows while it runs; the game window must keep focus.

```bash
DRY=1 ./bench.sh
```

```bash
./bench.sh
```

   Options: `--runs N` (default 2), `--scenarios play` (no ydotool needed), `--build DIR`, `--out DIR`, `--note "text"`; env `MEMORY_MAX=10G` (a systemd user scope with a memory cap, if available), `MH_PCI_DEV=0000:01:00.0` (which GPU MangoHud reads; default: the NVIDIA GPU on a machine with several GPUs), `GAME_ARGS`. The header of `bench.sh` lists all of them. If the machine is a laptop, plug it in and do not change power profiles between runs.

7. Send back. The output folder is `results/<date>-<commit>-<machine>/`. Fill the "Summary" and "Anything odd" parts of `report.md` and add the Kenshi store and version, then submit `results.csv` (and `report.md`) as described in "Submit your results" below. If something looks wrong, also send the `run.txt` and `game.log` of that run. Formats: `REPORT-TEMPLATE.md`, `results-format.md`.

## Submit your results

Results are published on the benchmark page by pull request to this repository. In short: add `data/machines/<machine-id>.json` (once) and copy your `results.csv` to `data/results/<machine-id>/<date>-<commit>.csv`, with `report.md` beside it as `<date>-<commit>.report.md` if you like. Your GitHub handle is shown on the page with your hardware. The exact steps, naming rules and what the automatic check verifies are in [`../CONTRIBUTING.md`](../CONTRIBUTING.md). Use the same value for `MACHINE` (step 2) as your machine id.

## Windows / Proton

What differs, honestly:

- **Native Windows is not automated.** The scripts are bash and the key sending uses ydotool (Linux). On Windows you can build with `dotnet publish -r win-x64` (the `update-and-build.sh windows` target does the same on Linux/WSL) and run the play benchmark by hand: set `KENSHI_PATH`, set `MEITOU_BENCH_ONLY=settle,idle,orbit,zoom,pan`, start `MeitouClient.exe --windowed --load <copy of the save> --play-bench <out>\bench`, then run `python3 bench-table.py <out>` for the table. The base-switch scenario would need the two double-taps by hand at 1 s and 6 s into each of its segments; this has never been tried.
- **Proton on Linux** is supported by `bench.sh --platform proton` as the maintainers run it, with `PROTON_BIN` pointing at the `proton` script (e.g. Proton Experimental) and an own compat prefix (`STEAM_COMPAT_DATA_PATH`, default `./proton-prefix`). `MANGOHUD=1` and the config file are passed the same way. Untested by anyone but the maintainers' machine: a fresh prefix, a different Proton version, the MangoHud log landing in the output folder under Proton (the script warns if no CSV appears), and whether `ydotool` keys reach the Proton window on other desktops.
- The Windows build normally also carries vendor DLLs (DLSS Streamline, FSR) that are not in the repository; the benchmark settings do not use them, but if the Windows build asks for them, copy them from a Meitou release into the build folder.
- Window size: the maintainers' window is maximised on a 2560x1440 screen (renders at 2560x1406). Other screens give other resolutions; the `resolution` column records it. The game parses a `--size WxH` argument (`GAME_ARGS="--size WxH"`), but it is not known whether it applies to the interactive window; untried.

## Files

| file | purpose |
|---|---|
| `update-and-build.sh` | fetch upstream master, publish native and/or Windows builds, install the settings |
| `bench.sh` | run the daily benchmark, write tables, `results.csv`, `report.md` |
| `lib.sh`, `bench-table.py` | helpers (hardware probes, MangoHud config, ydotool; tables and CSV) |
| `verify-save.sh` | check a save folder against the manifest |
| `meitou.user.json` | the settings file every benchmark build uses |
| `save-checksums.sha256` | SHA-256 of every file of the benchmark save |
| `REPORT-TEMPLATE.md`, `results-format.md` | the report and the CSV format |
