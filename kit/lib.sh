#!/usr/bin/env bash
# lib.sh: helpers shared by the dev-kit scripts. Source it; it prints nothing and changes nothing by itself.
#   die <msg>              print "<script>: <msg>" to stderr and exit 2
#   need_cmd <cmd> <hint>  die unless <cmd> is on PATH
#   mh_conf <dir> <secs>   write a MangoHud config (log only into <dir>, log_duration <secs>) and print its path
#   hw_info                set the MACHINE_* variables (CPU, RAM, GPU, driver, OS, kernel, display) from the system
#   keys_init / key_dbl <linux key code>   ydotool helpers (a key pressed twice quickly = a double tap)
#   ram_avail_mb           available RAM in MB
#   targets_json           print targets.json (the standard commits to benchmark): public copy first, then <kit>/../targets.json when offline
# Needs bash >= 4.4. Written for Linux; every probe has a fallback to "unknown" and an env override (see hw_info).

die() { echo "${PROG:-dev-kit}: $*" >&2; exit 2; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || die "'$1' not found on PATH. $2"; }
# --- benchmark standard: everyone benchmarks the same commits (the "targets"); the latest entry of targets.json is the current standard.
# TARGETS_URL is a placeholder until the public repository exists; offline, or while it does not, the copy next to the kit is used.
TARGETS_URL="${TARGETS_URL:-https://raw.githubusercontent.com/Demitrix2k/meitou-bench/main/targets.json}"
targets_json() {
  local f here_lib; here_lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; f="$(mktemp)"
  if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 10 "$TARGETS_URL" -o "$f" 2>/dev/null \
     && python3 -I -c 'import json,sys; json.load(open(sys.argv[1]))' "$f" 2>/dev/null; then cat "$f"
  elif [ -f "$here_lib/../targets.json" ]; then cat "$here_lib/../targets.json"; fi
  rm -f "$f"
}
# target_query latest|<commit>: prints "<commit8> <label>" of the latest target, or of the target equal to <commit>; nothing if none.
target_query() {
  targets_json | python3 -I -c '
import json, sys
try: t = json.load(sys.stdin)
except ValueError: sys.exit(0)
want = sys.argv[1]
for x in (reversed(t) if want == "latest" else t):
    if want == "latest" or x["commit"].startswith(want[:8]):
        print(x["commit"], x.get("label", "")); break' "$1"
}
ram_avail_mb() { awk '/^MemAvailable:/{printf "%d", $2/1024}' /proc/meminfo; }

# GPU_VENDOR_PCI: PCI address of the discrete NVIDIA GPU when the machine has more than one display controller (empty otherwise).
# MangoHud reads the GPU named in pci_dev. MH_PCI_DEV overrides: an address like 0000:01:00.0, or "none" to leave MangoHud's default.
mh_pci_dev() {
  if [ -n "${MH_PCI_DEV:-}" ]; then [ "$MH_PCI_DEV" = none ] || echo "$MH_PCI_DEV"; return 0; fi
  local d n=0 nv=""
  for d in /sys/bus/pci/devices/*; do
    [ -r "$d/class" ] || continue
    [ "$(( $(cat "$d/class") >> 16 ))" = 3 ] || continue      # PCI class 0x03: display controller
    n=$((n + 1))
    [ -z "$nv" ] && [ "$(cat "$d/vendor" 2>/dev/null)" = 0x10de ] && nv="$(basename "$d")"
  done
  [ "$n" -gt 1 ] && [ -n "$nv" ] && echo "$nv"
  return 0
}

mh_conf() {   # <log dir> <log seconds>: our own minimal config (not the user's MangoHud.conf, so every machine logs the same way)
  local f; f="$(mktemp "${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/mangohud-XXXXXX.conf")"
  { local p; p="$(mh_pci_dev)"; [ -n "$p" ] && echo "pci_dev=$p"
    [ -n "${MH_BASE_CONF:-}" ] && [ -r "$MH_BASE_CONF" ] && grep -vE '^[[:space:]]*(gpu_list|no_display|output_folder|log_duration|autostart_log|log_interval)[[:space:]]*=' "$MH_BASE_CONF"
    # never no_display (it turns logging off); log_duration shorter than the run (MangoHud writes its CSV only when the duration ends)
    printf 'output_folder=%s\nautostart_log=1\nlog_interval=100\nlog_duration=%s\n' "$1" "$2"; } > "$f"
  echo "$f"
}

hw_info() {   # sets MACHINE_CPU MACHINE_RAM_GB MACHINE_GPU MACHINE_GPU_DRIVER MACHINE_OS MACHINE_KERNEL MACHINE_DISPLAY; env CPU, RAM_GB, GPU_NAME, GPU_DRIVER, OS_NAME, DISPLAY_RES override
  MACHINE_CPU="${CPU:-$(grep -m1 -E '^(model name|Model)' /proc/cpuinfo 2>/dev/null | sed 's/^[^:]*: *//' | tr -s ' ' || true)}"
  [ -n "$MACHINE_CPU" ] || MACHINE_CPU=unknown
  MACHINE_RAM_GB="${RAM_GB:-$(awk '/^MemTotal:/{printf "%.0f", $2/1048576}' /proc/meminfo 2>/dev/null || true)}"; [ -n "$MACHINE_RAM_GB" ] || MACHINE_RAM_GB=unknown
  local g="" name="" drv=""
  if command -v nvidia-smi >/dev/null 2>&1; then
    g="$(nvidia-smi --query-gpu=name,driver_version --format=csv,noheader 2>/dev/null | head -1 || true)"
    name="${g%%,*}"; drv="${g#*, }"; [ "$g" = "$name" ] && drv=""
  fi
  if [ -z "$name" ] && command -v vulkaninfo >/dev/null 2>&1; then
    g="$(vulkaninfo --summary 2>/dev/null || true)"
    name="$(printf '%s\n' "$g" | sed -n 's/^[[:space:]]*deviceName *= *//p' | head -1)"
    drv="$(printf '%s\n' "$g" | sed -n 's/^[[:space:]]*driverInfo *= *//p' | head -1)"
  fi
  if [ -z "$name" ] && command -v glxinfo >/dev/null 2>&1; then
    g="$(glxinfo -B 2>/dev/null || true)"
    name="$(printf '%s\n' "$g" | sed -n 's/^OpenGL renderer string: *//p' | head -1)"
    drv="$(printf '%s\n' "$g" | sed -n 's/^OpenGL version string: *//p' | head -1)"
  fi
  MACHINE_GPU="${GPU_NAME:-${name:-unknown}}"; MACHINE_GPU_DRIVER="${GPU_DRIVER:-${drv:-unknown}}"
  local os; os="${OS_NAME:-}"
  [ -n "$os" ] || os="$( ( . /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-$NAME}" ) || true)"
  MACHINE_OS="${os:-$(uname -s)}"; MACHINE_KERNEL="$(uname -r)"
  local res="${DISPLAY_RES:-}"
  [ -n "$res" ] || res="$(xrandr --current 2>/dev/null | awk '/\*/{print $1; exit}' || true)"
  MACHINE_DISPLAY="${res:-unknown}"
}

# --- key input (ydotool): only the base-switch scenario needs it. Raw Linux key codes: 2 = key "1", 3 = key "2" (layout independent).
keys_init() {
  need_cmd ydotool "The base-switch scenario sends keys with ydotool (https://github.com/ReimuNotMoe/ydotool); install it, or run with --scenarios play."
  local s; if [ -z "${YDOTOOL_SOCKET:-}" ]; then
    for s in /tmp/.ydotool_socket "${XDG_RUNTIME_DIR:-/nonexistent}/.ydotool_socket"; do [ -S "$s" ] && { YDOTOOL_SOCKET="$s"; break; }; done
  fi
  if [ -z "${YDOTOOL_SOCKET:-}" ] || [ ! -S "${YDOTOOL_SOCKET:-}" ]; then
    command -v ydotoold >/dev/null 2>&1 || die "no ydotool daemon socket and no ydotoold on PATH. Start ydotoold (needs access to /dev/uinput) or set YDOTOOL_SOCKET."
    YDOTOOL_SOCKET="${YDOTOOL_SOCKET:-/tmp/.ydotool_socket}"
    ydotoold --socket-path="$YDOTOOL_SOCKET" >/dev/null 2>&1 &
    YDOTOOLD_PID=$!; sleep 1
    [ -S "$YDOTOOL_SOCKET" ] && kill -0 "$YDOTOOLD_PID" 2>/dev/null || die "could not start ydotoold (is /dev/uinput writable for you? try: sudo ydotoold, then set YDOTOOL_SOCKET=<its socket>)"
  fi
  export YDOTOOL_SOCKET
}
key_dbl() { ydotool key "$1:1" "$1:0" "$1:1" "$1:0"; }
