#!/usr/bin/env bash
# bench.sh: the Meitou daily benchmark, for any machine. Runs N times the upstream play benchmark (--play-bench: idle, orbit, zoom, pan) and N times the
# base-switch scenario, back-to-back, on a frozen save with clean (unmodded) Kenshi data, then prints the tables and writes results.csv and report.md.
# It is the same measurement as the maintainers' `bench-compare.sh --daily`; see README.md and results-format.md in this folder.
#
# Usage:  KENSHI_PATH=<Kenshi install> ./bench.sh [options]
#   --platform native|proton   native (default): the Linux build.  proton: the Windows build run with Proton (see README, "Windows / Proton"; untested elsewhere).
#   --runs <n>                 runs of each scenario (default 2: run 1 may be cache-cold, so the first is not thrown away but both are reported)
#   --scenarios play,bases     which scenarios to run (default both). "bases" needs ydotool and sends keys to the focused window.
#   --build <dir>              the build folder (default <kit>/builds/Meitou-master-linux, or Meitou-master-win for proton; made by update-and-build.sh)
#   --out <dir>                output folder (default <kit>/results/<date>-<commit>-<machine>); must not hold runs already: nothing is overwritten
#   --note <text>              extra text for the note column of results.csv
# Env (required first):
#   KENSHI_PATH      the Kenshi install folder: it holds data/ (clean, no mods) and, normally, save/. The game is started with this as its data.
#   SAVE_DIR         the benchmark save folder (default $KENSHI_PATH/save/bench-bases-2026-10-27). Verified against save-checksums.sha256 and then COPIED
#                    into the output folder; the copy is what the game loads. The original is only read.
# Env (optional):
#   MACHINE, WHO     short label of the machine and your name or handle for the report/CSV (default: empty, fill in report.md)
#   MEMORY_MAX       e.g. 10G: run each game in a systemd user scope with this memory cap (only if `systemd-run --user` works; otherwise no cap)
#   MH_PCI_DEV       GPU for MangoHud as a PCI address (0000:01:00.0), or "none". Default: the NVIDIA GPU if the machine has several GPUs, else MangoHud's choice.
#                    MH_BASE_CONF=<file>  a MangoHud config to start from (default: none; our logging lines are always added after it).
#   MH_SECONDS       MangoHud log_duration (default 60; must be shorter than the run)       TIMEOUT   longest wait per run, seconds (default 420)
#   MIN_RAM_MB       refuse to start below this much available RAM (default 6144)
#   YDOTOOL_SOCKET   socket of ydotoold (default: found in /tmp or $XDG_RUNTIME_DIR; ydotoold is started if it is not running)
#   KEEP_WAYLAND=1   keep WAYLAND_DISPLAY set for the game (default: unset, as the maintainers do: the game opens through XWayland)
#   GAME_ARGS        extra arguments for the game, appended after the built-in ones (e.g. "--size 1920x1080": untested; changes the numbers, say so in the note)
#   ALLOW_SAVE_MISMATCH=1 / ALLOW_SETTINGS_DIFF=1   go on although the save or the settings differ from the kit's; the report says so
#   CPU RAM_GB GPU_NAME GPU_DRIVER OS_NAME DISPLAY_RES   override the hardware probes (see lib.sh)
#   Proton only: PROTON_BIN (the `proton` script, required), STEAM_COMPAT_DATA_PATH (default <kit>/proton-prefix), STEAM_COMPAT_CLIENT_INSTALL_PATH (default ~/.local/share/Steam)
#   DRY=1            check everything and print the commands, start nothing
# What it does for every run: refuses if a game is running or RAM is short; starts the game windowed, full settings (no --low-end), with MangoHud logging
#   (never no_display; log_duration shorter than the run), waits for the benchmark to end by itself (the game quits), and for the base-switch scenario double-taps
#   2 then 1 at 1 s and 6 s into each of the segments idle and return (four switches). The game must keep focus: do not click elsewhere during a run.
# Exit codes: 0 all runs fine, 1 a run failed, 2 refused or bad usage.
set -euo pipefail
PROG=bench.sh
here="$(cd "$(dirname "$0")" && pwd)"; . "$here/lib.sh"
TABLE="$here/bench-table.py"
PLATFORM=native; RUNS=2; SCENARIOS=play,bases; BUILD_DIR="${BUILD_DIR:-}"; OUT="${OUT:-}"; NOTE="${NOTE:-}"
DRY="${DRY:-}"; MH_SECONDS="${MH_SECONDS:-60}"; TIMEOUT="${TIMEOUT:-420}"; MIN_RAM_MB="${MIN_RAM_MB:-6144}"; MACHINE="${MACHINE:-}"; WHO="${WHO:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --platform) PLATFORM=${2:?}; shift 2;;  --runs) RUNS=${2:?}; shift 2;;  --scenarios) SCENARIOS=${2:?}; shift 2;;
    --build) BUILD_DIR=${2:?}; shift 2;;  --out) OUT=${2:?}; shift 2;;  --note) NOTE=${2:?}; shift 2;;
    -h|--help) sed -n '2,34p' "$0"; exit 0;;
    *) die "unknown argument '$1' (see the header of $0)";;
  esac
done
case "$PLATFORM" in native|proton) ;; *) die "--platform must be native or proton";; esac
[[ "$RUNS" =~ ^[1-9][0-9]*$ ]] || die "--runs must be a positive number"
[[ "$TIMEOUT" =~ ^[0-9]+$ ]] || die "TIMEOUT must be seconds"
[ "$MH_SECONDS" -lt "$TIMEOUT" ] 2>/dev/null || die "MH_SECONDS ($MH_SECONDS) must be a number below TIMEOUT"
for s in ${SCENARIOS//,/ }; do case "$s" in play|bases) ;; *) die "--scenarios takes play and/or bases";; esac; done

# ---- inputs
[ -n "${KENSHI_PATH:-}" ] || die "set KENSHI_PATH to your Kenshi install folder (the one with data/ and save/)"
KENSHI_PATH="$(realpath "$KENSHI_PATH")"
[ -d "$KENSHI_PATH/data" ] || die "no data/ folder in KENSHI_PATH=$KENSHI_PATH"
SAVE_DIR="${SAVE_DIR:-$KENSHI_PATH/save/bench-bases-2026-10-27}"
[ -d "$SAVE_DIR" ] || die "benchmark save not found: $SAVE_DIR (unzip bench-bases-2026-10-27.zip into $KENSHI_PATH/save/ or set SAVE_DIR; see README step 3)"
SAVE_DIR="$(realpath "$SAVE_DIR")"; SAVE_NAME="$(basename "$SAVE_DIR")"
exe=MeitouClient; sfx=linux; [ "$PLATFORM" = proton ] && { exe=MeitouClient.exe; sfx=win; }
BUILD_DIR="${BUILD_DIR:-$here/builds/Meitou-master-$sfx}"
[ -f "$BUILD_DIR/$exe" ] || die "no $exe in $BUILD_DIR (build it: ./update-and-build.sh $([ $PLATFORM = proton ] && echo windows || echo native); or pass --build)"
BUILD_DIR="$(realpath "$BUILD_DIR")"
commit="$(grep -oE '[0-9a-f]{8}' "$BUILD_DIR/BUILT_FROM.txt" 2>/dev/null | tail -1 || true)"
[ -n "$commit" ] || die "cannot read a commit from $BUILD_DIR/BUILT_FROM.txt (build with update-and-build.sh)"
# Benchmark standard: say in the report whether this commit is a target (the latest target is the current standard).
if tq="$(target_query "$commit")" && [ -n "$tq" ]; then TARGET_NOTE="commit $commit is a benchmark target (${tq#* })"
else
  lt="$(target_query latest || true)"
  TARGET_NOTE="commit $commit is NOT a benchmark target${lt:+ (the current standard is ${lt%% *})}: accepted when submitted, but flagged off-target and left out of cross-machine comparisons (unless it is code-identical to a target)"
  TARGET_OFF=1
fi
need_cmd python3 "Install python3."; need_cmd sha256sum "Install coreutils."; need_cmd timeout "Install coreutils."
need_cmd mangohud "Install MangoHud (the benchmark's frame-time cross-check and GPU log)."
case ",$SCENARIOS," in *,bases,*) [ -n "$DRY" ] || keys_init;; esac
z=""; runner=(mangohud "./$exe")
if [ "$PLATFORM" = proton ]; then
  [ -n "${PROTON_BIN:-}" ] && [ -f "$PROTON_BIN" ] || die "set PROTON_BIN to the 'proton' script (e.g. .../steamapps/common/Proton - Experimental/proton)"
  z="Z:"; runner=(python3 "$PROTON_BIN" run "./$exe")
fi

# settings: the build's meitou.user.json must hold every value of the kit's (the game adds keys of its own when it starts)
[ -f "$BUILD_DIR/meitou.user.json" ] || die "$BUILD_DIR/meitou.user.json is missing: copy $here/meitou.user.json there (update-and-build.sh does)"
settings_state="unchanged (all values of the kit's meitou.user.json)"; WARN=(); [ -z "${TARGET_OFF:-}" ] || WARN+=("$TARGET_NOTE")
if ! sd="$(python3 -I "$TABLE" --settings-diff "$here/meitou.user.json" "$BUILD_DIR/meitou.user.json")"; then
  [ -n "${ALLOW_SETTINGS_DIFF:-}" ] || die "the build's meitou.user.json differs from the kit's:"$'\n'"$sd"$'\n'"copy the kit's file over it, or ALLOW_SETTINGS_DIFF=1 to go on (the report will list the differences)"
  settings_state="CHANGED: $(printf '%s' "$sd" | tr '\n' ';')"; WARN+=("settings differ from the kit's: $sd")
fi

# save: verify the original, never write into it
sums="$here/save-checksums.sha256"
verify_save() {   # <folder>: 0 if it matches the manifest exactly (same files, same hashes)
  [ -f "$sums" ] || return 0
  ( cd "$1" && sha256sum --check --quiet "$sums" >/dev/null 2>&1 ) && [ "$(cd "$1" && find . -type f | wc -l)" = "$(wc -l < "$sums")" ]
}
save_state="verified against save-checksums.sha256"
if [ ! -f "$sums" ]; then save_state="NOT verified (no save-checksums.sha256 in the kit)"; WARN+=("$save_state")
elif ! verify_save "$SAVE_DIR"; then
  [ -n "${ALLOW_SAVE_MISMATCH:-}" ] || die "$SAVE_DIR does not match save-checksums.sha256 (other files or other contents). Get a fresh bench-bases-2026-10-27.zip, or ALLOW_SAVE_MISMATCH=1 to go on (numbers are then not comparable)."
  save_state="MISMATCH with save-checksums.sha256 (ALLOW_SAVE_MISMATCH)"; WARN+=("$save_state")
fi
save_sum="$( [ -f "$sums" ] && sha256sum "$sums" | cut -c1-64 || echo none)"

# ---- machine, output folder
hw_info
[ -n "$MACHINE" ] || { MACHINE=unnamed; WARN+=("MACHINE not set: the machine column says 'unnamed'"); }
OUT="${OUT:-$here/results/$(date +%F)-$commit-$MACHINE}"; OUT="$(realpath -m "$OUT")"
if [ -d "$OUT" ] && [ -n "$(find "$OUT" -maxdepth 3 \( -name frames.csv -o -name results.csv \) 2>/dev/null | head -1)" ]; then die "$OUT already holds results; use --out <new folder>"; fi

# ---- refusals: one game at a time, enough RAM
busy="$(ps -eo pid,args | grep -iE '(^|[ /\\])(MeitouClient(\.exe)?|kenshi_(gog_)?x64\.exe)( |$)' | grep -vE 'grep|bench\.sh' || true)"
[ -z "$busy" ] || die "a game is already running:"$'\n'"$busy"$'\n'"end it first"
avail="$(ram_avail_mb)"; [ "$avail" -ge "$MIN_RAM_MB" ] || die "only $avail MB RAM available (need $MIN_RAM_MB; MIN_RAM_MB to change)"

mkdir -p "$OUT"
{ echo "machine: $MACHINE"; echo "who: $WHO"; echo "cpu: $MACHINE_CPU"; echo "ram_gb: $MACHINE_RAM_GB"; echo "gpu: $MACHINE_GPU"; echo "gpu_driver: $MACHINE_GPU_DRIVER"
  echo "os: $MACHINE_OS"; echo "kernel: $MACHINE_KERNEL"; echo "display: $MACHINE_DISPLAY"; echo "commit: $commit"; echo "build: $BUILD_DIR"; echo "platform: $PLATFORM"
  echo "mangohud_pci_dev: $(mh_pci_dev)"; echo "kenshi_path: $KENSHI_PATH"; } > "$OUT/machine.txt"
est=$(( RUNS * $(echo "$SCENARIOS" | tr ',' '\n' | wc -l) * 110 / 60 ))
echo "bench.sh: $TARGET_NOTE"
echo "bench.sh: $PLATFORM, build $(basename "$BUILD_DIR") ($commit), save $SAVE_NAME ($save_state), $RUNS run(s) of: $SCENARIOS; about $est min of game time; output $OUT"
if [ -z "$DRY" ]; then
  echo "copying the save to $OUT/save-copy ..."; mkdir -p "$OUT/save-copy"; cp -a "$SAVE_DIR" "$OUT/save-copy/$SAVE_NAME"
fi
SAVE_COPY="$OUT/save-copy/$SAVE_NAME"

# ---- one run
fails=0; pid=""; trap '[ -n "$pid" ] && kill "$pid" 2>/dev/null; [ -n "${YDOTOOLD_PID:-}" ] && kill "$YDOTOOLD_PID" 2>/dev/null; exit 130' INT TERM
scope=()
if [ -n "${MEMORY_MAX:-}" ] && command -v systemd-run >/dev/null 2>&1 && systemctl --user is-system-running >/dev/null 2>&1; then
  scope=(systemd-run --user --scope --quiet -p "MemoryMax=$MEMORY_MAX" -p MemorySwapMax=3G --)
elif [ -n "${MEMORY_MAX:-}" ]; then echo "bench.sh: MEMORY_MAX is set but systemd-run --user is not available: running without a memory cap" >&2; fi

run_one() {   # <job dir> <scenario play|bases> <k>
  local job=$1 scen=$2 k=$3 segs prefix run mdir only env_plat args cf t0 rc secs kpid=""
  if [ "$scen" = bases ]; then segs=idle,return; prefix="$PLATFORM-gog-bases"; else segs=idle,orbit,zoom,pan; prefix="$PLATFORM-gog"; fi
  only="settle,$segs"; run="$job/$prefix-$k-master"; mdir="$run/meitou"
  [ ! -e "$run" ] || die "$run exists; results are never overwritten"
  env_plat=("MEITOU_BENCH_ONLY=$only" "KENSHI_PATH=$z$KENSHI_PATH")
  if [ "$PLATFORM" = proton ]; then
    env_plat+=(MANGOHUD=1 "STEAM_COMPAT_DATA_PATH=${STEAM_COMPAT_DATA_PATH:-$here/proton-prefix}" "STEAM_COMPAT_CLIENT_INSTALL_PATH=${STEAM_COMPAT_CLIENT_INSTALL_PATH:-$HOME/.local/share/Steam}")
    mkdir -p "${STEAM_COMPAT_DATA_PATH:-$here/proton-prefix}"
  fi
  # shellcheck disable=SC2206
  args=(--windowed --load "$z$SAVE_COPY" --play-bench "$z$run/bench" ${GAME_ARGS:-})
  if [ -n "$DRY" ]; then
    echo "--- $scen run $k: $prefix-$k-master"; echo "cd $BUILD_DIR"
    echo "env ${env_plat[*]} MANGOHUD_CONFIGFILE=<config: pci_dev=$(mh_pci_dev), output_folder=$mdir, autostart_log=1, log_interval=100, log_duration=$MH_SECONDS>"
    echo "  ${scope[*]:-} timeout -k 15 $TIMEOUT ${runner[*]} ${args[*]}"; return 0
  fi
  mkdir -p "$mdir"; cf="$(mh_conf "$mdir" "$MH_SECONDS")"
  { echo "started $(date -Is) data=gog platform=$PLATFORM"; echo "cd $BUILD_DIR"; echo "env ${env_plat[*]} MANGOHUD_CONFIGFILE=$cf ${scope[*]:-} timeout -k 15 $TIMEOUT ${runner[*]} ${args[*]}"; } > "$mdir/launch.txt"
  echo "== $scen run $k: $prefix-$k-master"
  t0=$(date +%s)
  ( cd "$BUILD_DIR"; [ -n "${KEEP_WAYLAND:-}" ] || unset WAYLAND_DISPLAY
    exec env "${env_plat[@]}" "MANGOHUD_CONFIGFILE=$cf" "${scope[@]}" timeout -k 15 "$TIMEOUT" "${runner[@]}" "${args[@]}" > "$mdir/game.log" 2>&1 ) &
  pid=$!
  if [ "$scen" = bases ]; then   # the key driver follows the benchmark's segment lines in game.log
    ( local seg; for seg in idle return; do
        until grep -q "^bench     $seg (" "$mdir/game.log" 2>/dev/null; do sleep 0.2; kill -0 "$pid" 2>/dev/null || exit 0; done
        sleep 1; key_dbl 3 && echo "$(date +%T) $seg: double-tap 2" >> "$mdir/steps.log"
        sleep 5; key_dbl 2 && echo "$(date +%T) $seg: double-tap 1" >> "$mdir/steps.log"
      done ) & kpid=$!
  fi
  rc=0; wait "$pid" || rc=$?
  [ -z "$kpid" ] || { kill "$kpid" 2>/dev/null || true; wait "$kpid" 2>/dev/null || true; }
  pid=""; secs=$(( $(date +%s) - t0 ))
  {
    echo "exit=$rc seconds=$secs$([ "$rc" = 124 ] && echo ' timedout')"
    g="$(grep -m1 -E 'MANGOHUD.*active GPU' "$mdir/game.log" | sed 's/^.*\] //' || true)"
    if [ -n "$g" ]; then echo "MangoHud: $g"; else echo "WARNING MangoHud GPU line not found in game.log"; fi
    ls "$mdir"/*.csv >/dev/null 2>&1 || echo "WARNING no MangoHud CSV written"
    [ "$scen" = bases ] && echo "keys sent: $(grep -c 'double-tap' "$mdir/steps.log" 2>/dev/null || true) of 4"
    [ -f "$run/bench/frames.csv" ] || echo "FAILED no bench/frames.csv"
  } > "$run/run.txt"
  sed 's/^/   /' "$run/run.txt"
  [ -f "$run/bench/frames.csv" ] || fails=$((fails + 1))
  sleep 3
}

run_job() {   # <scenario>
  local scen=$1 job="$OUT/$1" k segs
  if [ "$scen" = bases ]; then segs="bases:idle,return"; else segs="idle,orbit,zoom,pan"; fi
  if [ -z "$DRY" ]; then
    mkdir -p "$job"; printf 'master\t%s\t%s\n' "$(basename "$BUILD_DIR")" "$commit" > "$job/builds.txt"
    printf 'platform=%s\ndata=gog\nsave=%s\nsegments=%s\n' "$PLATFORM" "$SAVE_NAME" "$segs" > "$job/settings.txt"
  fi
  for k in $(seq 1 "$RUNS"); do run_one "$job" "$scen" "$k"; done
}
for s in ${SCENARIOS//,/ }; do run_job "$s"; done
[ -z "$DRY" ] || { echo "(DRY: nothing was started; about $est min of game time)"; exit 0; }
[ -z "${YDOTOOLD_PID:-}" ] || kill "$YDOTOOLD_PID" 2>/dev/null || true

# ---- results
if [ -f "$sums" ] && ! verify_save "$SAVE_COPY"; then WARN+=("the save copy changed while the game ran (autosave?): later runs started from a changed save"); fi
note="series 2: 2 runs per scenario (run 1 may be cache-cold); dev kit"; [ -n "$NOTE" ] && note="$note; $NOTE"
for s in ${SCENARIOS//,/ }; do
  python3 -I "$TABLE" --history "$OUT/results.csv" "$OUT/$s" "$note" "$MACHINE_GPU_DRIVER" "$MACHINE" "$MACHINE_CPU" "$MACHINE_RAM_GB" "$MACHINE_OS" "$MACHINE_KERNEL"
done
tbl() { [ -d "$OUT/$1" ] && python3 -I "$TABLE" "$OUT/$1" || echo "(scenario $1 not run)"; }
R_PLAY="$(tbl play || true)"; R_BASES="$(tbl bases || true)"
runwarn="$(grep -H -E 'WARNING|FAILED|exit=[1-9]' "$OUT"/*/*/run.txt 2>/dev/null | sed "s#^$OUT/##" || true)"
[ -z "$runwarn" ] || WARN+=("run warnings:"$'\n'"$runwarn")
echo; echo "## play benchmark"; echo "$R_PLAY"; echo; echo "## base switch"; echo "$R_BASES"

export R_WHO="$WHO" R_DATE="$(date +%F)" R_MACHINE="$MACHINE" R_CPU="$MACHINE_CPU" R_RAM="$MACHINE_RAM_GB GB" R_GPU="$MACHINE_GPU" R_OS="$MACHINE_OS" R_KERNEL="$MACHINE_KERNEL"
export R_DRIVER="$MACHINE_GPU_DRIVER" R_DISPLAY="$MACHINE_DISPLAY (desktop; the benchmark's render size is in the resolution column of results.csv)" R_COMMIT="$commit"
export R_BUILD_TYPE="$([ "$PLATFORM" = proton ] && echo 'Windows build under Proton' || echo 'native Linux')" R_SETTINGS="$settings_state"
export R_DATA="clean Kenshi data, no mods (path: $KENSHI_PATH); store and game version: fill in" R_SAVE="$SAVE_NAME" R_SAVE_SUM="$save_sum (sha256 of save-checksums.sha256); $save_state"
export R_RESULTS_PLAY="$R_PLAY" R_RESULTS_BASES="$R_BASES" R_RUNS="$RUNS" R_NOTE="$NOTE"
R_WARNINGS="$( [ ${#WARN[@]} -gt 0 ] && printf -- '- %s\n' "${WARN[@]}" || echo '- none from the script' )"; export R_WARNINGS
python3 -I - "$here/REPORT-TEMPLATE.md" > "$OUT/report.md" <<'PY'
import os, re, sys
t = open(sys.argv[1]).read()
print(re.sub(r'\{\{([A-Z_]+)\}\}', lambda m: os.environ.get('R_' + m.group(1), m.group(0)), t), end='')
PY
echo; echo "written: $OUT/results.csv (send this) and $OUT/report.md (fill in the summary, then send it too)"
[ $fails -eq 0 ] || { echo "$fails run(s) failed (see run.txt in their folders)" >&2; exit 1; }
