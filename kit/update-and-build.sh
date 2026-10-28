#!/usr/bin/env bash
# update-and-build.sh: fetch upstream Meitou master, build it the way the maintainers do (self-contained release publish), install the benchmark settings file.
#
# Usage:  update-and-build.sh [native|windows|both]            default: native (the Linux build). "windows" = the win-x64 build, for Proton / Windows.
# Env (all optional):
#   MEITOU_SRC       clone of MeitouClient to use (default: <kit>/MeitouClient; cloned there if missing). Your working tree is never touched:
#                    the commit is built from a temporary git worktree.
#   MEITOU_URL       what to clone (default https://github.com/VlcekM/MeitouClient.git)
#   REMOTE, REF      what to build. Default REF = the latest benchmark target (the current standard, read from targets.json, see lib.sh); the build
#                    folder is then Meitou-master-<linux|win>. REF=origin/master or any other commit/branch still works, with a warning that the
#                    result is off-target (it is accepted when submitted but flagged); the build folder is then named after it.
#   BUILD_ROOT       where builds go (default: <kit>/builds). Folders: <BUILD_ROOT>/Meitou-master-linux and Meitou-master-win (or Meitou-<ref>-<sha>-... for another REF).
#   DOTNET_ROOT      folder of a .NET SDK that is not on PATH (it is put first on PATH). Otherwise `dotnet` from PATH; the SDK must be 10.x.
#   MEMORY_MAX       e.g. 6G: run the publish in a systemd user scope with this memory cap (only if `systemd-run --user` works; otherwise ignored).
#   FORCE=1          rebuild even if the build folder already holds this commit.
# Each build folder gets BUILT_FROM.txt ("<name>-<sha8> (<runtime id>)", read by bench.sh for the commit) and meitou.user.json (the kit's settings file;
# a rebuild recreates the folder, so the settings file is always installed again).
# Not done: the Windows build of the maintainers also carries vendor DLLs (DLSS Streamline, FSR, ...) that are not in the repository; they are not needed
# for the benchmark settings (TAA, no upscaler DLL) but copy them from a Meitou release into the folder if the Windows build asks for them.
set -euo pipefail
PROG=update-and-build.sh
here="$(cd "$(dirname "$0")" && pwd)"; . "$here/lib.sh"
target="${1:-native}"; case "$target" in native|windows|both) ;; *) die "usage: $0 [native|windows|both]";; esac
MEITOU_SRC="${MEITOU_SRC:-$here/MeitouClient}"; MEITOU_URL="${MEITOU_URL:-https://github.com/VlcekM/MeitouClient.git}"
REMOTE="${REMOTE:-origin}"; BUILD_ROOT="${BUILD_ROOT:-$here/builds}"
[ -z "${DOTNET_ROOT:-}" ] || { [ -x "$DOTNET_ROOT/dotnet" ] || die "DOTNET_ROOT=$DOTNET_ROOT has no dotnet executable"; export PATH="$DOTNET_ROOT:$PATH"; }
need_cmd git "Install git."
need_cmd dotnet "Install the .NET 10 SDK (https://dotnet.microsoft.com/download) or set DOTNET_ROOT to its folder."
sdks="$(dotnet --list-sdks)"; grep -qE '^10\.' <<<"$sdks" || die ".NET SDK 10.x not found (dotnet --list-sdks says: $(tr '\n' ' ' <<<"$sdks"))"
[ -f "$here/meitou.user.json" ] || die "$here/meitou.user.json (the benchmark settings) is missing from the kit"

if [ ! -d "$MEITOU_SRC/.git" ] && [ ! -f "$MEITOU_SRC/.git" ]; then
  echo "cloning $MEITOU_URL into $MEITOU_SRC"; git clone "$MEITOU_URL" "$MEITOU_SRC"
fi
git -C "$MEITOU_SRC" remote get-url "$REMOTE" >/dev/null 2>&1 || die "$MEITOU_SRC has no remote '$REMOTE' (set REMOTE=<name of the upstream remote>)"
git -C "$MEITOU_SRC" fetch "$REMOTE"
# Default: build the latest benchmark target, so every machine benchmarks the same commit.
if [ -z "${REF:-}" ]; then
  read -r tcommit tlabel < <(target_query latest) || true
  [ -n "${tcommit:-}" ] || die "cannot read the current benchmark target (no network and no ../targets.json). Set REF=<commit> to build a specific commit."
  echo "current benchmark standard: $tcommit ${tlabel:+($tlabel)}"
  REF="$tcommit"; DEFAULT_TARGET=1
else
  echo "WARNING: REF=$REF is set, so this build is probably OFF-TARGET: results for commits that are not benchmark targets are accepted but flagged on the page and left out of cross-machine comparisons." >&2
fi
sha="$(git -C "$MEITOU_SRC" rev-parse --short=8 "$REF^{commit}")" || die "cannot resolve $REF in $MEITOU_SRC"
if [ -n "${DEFAULT_TARGET:-}" ] || [ "$REF" = "$REMOTE/master" ]; then name=Meitou-master; bname="origin-master-$sha"; else name="Meitou-$(echo "$REF" | tr '/' '-')-$sha"; bname="$(echo "$REF" | tr '/' '-')-$sha"; fi
echo "building $REF = $sha ($(git -C "$MEITOU_SRC" log -1 --format=%s "$sha" | cut -c1-100))"

scope=()
if [ -n "${MEMORY_MAX:-}" ] && command -v systemd-run >/dev/null 2>&1 && systemctl --user is-system-running >/dev/null 2>&1; then
  scope=(systemd-run --user --scope --quiet -p "MemoryMax=$MEMORY_MAX" -p MemorySwapMax=0 --)
fi
tree="$(mktemp -d)"; trap 'git -C "$MEITOU_SRC" worktree remove --force "$tree" 2>/dev/null || true; rm -rf "$tree"' EXIT
git -C "$MEITOU_SRC" worktree add -f --detach "$tree" "$sha" -q
mkdir -p "$BUILD_ROOT"

publish() {   # <rid> <suffix>
  local out="$BUILD_ROOT/$name-$2"
  if [ -z "${FORCE:-}" ] && grep -q "$sha" "$out/BUILT_FROM.txt" 2>/dev/null && { [ -e "$out/MeitouClient" ] || [ -e "$out/MeitouClient.exe" ]; }; then
    echo "$out already holds $sha (FORCE=1 to rebuild)"; return 0
  fi
  rm -rf "$out"; mkdir -p "$out"
  "${scope[@]}" dotnet publish "$tree/src/Meitou.Game/Meitou.Game.csproj" -c Release -r "$1" --self-contained true -p:DebugType=embedded -o "$out"
  echo "$bname ($1)" > "$out/BUILT_FROM.txt"
  cp "$here/meitou.user.json" "$out/meitou.user.json"
  { [ -e "$out/MeitouClient" ] || [ -e "$out/MeitouClient.exe" ]; } || die "publish finished but there is no MeitouClient in $out"
  echo "done: $out ($sha)"
}
case "$target" in native|both) publish linux-x64 linux;; esac
case "$target" in windows|both) publish win-x64 win;; esac
