"""Tests of the kit's per-OS command builders and probe parsers. They force the OS and run nothing: they can run on any OS.
Run:  python3 -m unittest discover -s tests -v      (from the repository root)
"""
import json
import pathlib
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "kit"))
import bench  # noqa: E402
import build  # noqa: E402
import kitkeys  # noqa: E402
import kitlib as K  # noqa: E402


def cfg(osname, plat, **kw):
    c = dict(osname=osname, plat=plat, kenshi="/k", save_copy="/o/save-copy/s", build_dir="/b", only="settle,idle", game_args="", mangohud=False, mh_conf="/o/m.conf",
             scope=[], env={}, proton_bin="/p/proton", compat_data="/pfx", compat_client="/steam", keep_wayland=False, mac_vulkan_dir="/opt/homebrew/lib", python="py")
    c.update(kw)
    return c


class Platforms(unittest.TestCase):
    def test_rid(self):
        self.assertEqual(K.host_rid("linux", "x86_64"), "linux-x64")
        self.assertEqual(K.host_rid("windows", "AMD64"), "win-x64")
        self.assertEqual(K.host_rid("macos", mac_arm=True), "osx-arm64")
        self.assertEqual(K.host_rid("macos", mac_arm=False), "osx-x64")
        with self.assertRaises(K.KitError):
            K.host_rid("linux", "aarch64")
        self.assertEqual(K.platform_rid("proton", "linux"), "win-x64")

    def test_check_platform(self):
        K.check_platform("native", "linux"); K.check_platform("proton", "linux"); K.check_platform("windows", "windows"); K.check_platform("macos", "macos")
        for p, o in (("native", "windows"), ("windows", "linux"), ("macos", "linux"), ("proton", "macos"), ("bogus", "linux")):
            with self.assertRaises(K.KitError):
                K.check_platform(p, o)

    def test_family_and_defaults(self):
        self.assertEqual([K.os_family(p) for p in K.PLATFORMS], ["linux", "linux", "windows", "macos"])
        self.assertEqual([K.default_platform(o) for o in ("linux", "windows", "macos")], ["native", "windows", "macos"])
        self.assertTrue(bench.build_dir_default("macos", "macos", mac_arm=True).endswith("Meitou-master-osx-arm64"))
        self.assertTrue(bench.build_dir_default("proton", "linux").endswith("Meitou-master-win"))


class Launch(unittest.TestCase):
    def test_linux_native(self):
        l = bench.game_launch(cfg("linux", "native"), "/o/play/r", "/o/play/r/meitou")
        self.assertEqual(l["argv"][0], "./MeitouClient")
        self.assertEqual(l["argv"][1:], ["--windowed", "--load", "/o/save-copy/s", "--play-bench", "/o/play/r/bench"])
        self.assertEqual(l["unset"], ["WAYLAND_DISPLAY"])
        self.assertEqual(l["env"], {"MEITOU_BENCH_ONLY": "settle,idle", "KENSHI_PATH": "/k"})

    def test_linux_mangohud_scope(self):
        l = bench.game_launch(cfg("linux", "native", mangohud=True, scope=["systemd-run", "--user", "--scope", "--"]), "/o/r", "/o/r/m")
        self.assertEqual(l["argv"][:6], ["systemd-run", "--user", "--scope", "--", "mangohud", "./MeitouClient"])
        self.assertEqual(l["env"]["MANGOHUD_CONFIGFILE"], "/o/m.conf")

    def test_proton(self):
        l = bench.game_launch(cfg("linux", "proton", mangohud=True), "/o/r", "/o/r/m")
        self.assertEqual(l["argv"][:4], ["py", "/p/proton", "run", "./MeitouClient.exe"])
        self.assertIn("Z:/k", l["env"]["KENSHI_PATH"]); self.assertIn("Z:/o/save-copy/s", l["argv"])
        self.assertEqual((l["env"]["MANGOHUD"], l["env"]["STEAM_COMPAT_DATA_PATH"]), ("1", "/pfx"))

    def test_windows(self):
        l = bench.game_launch(cfg("windows", "windows", game_args='--size "1920x1080"'), "C:/o/r", "C:/o/r/m")
        self.assertTrue(l["argv"][0].endswith("MeitouClient.exe"))
        self.assertEqual(l["unset"], [])
        self.assertEqual(l["argv"][-2:], ["--size", "1920x1080"])
        self.assertNotIn("DYLD_LIBRARY_PATH", l["env"])

    def test_macos(self):
        l = bench.game_launch(cfg("macos", "macos", env={"DYLD_LIBRARY_PATH": "/x"}), "/o/r", "/o/r/m")
        self.assertEqual(l["argv"][0], "./MeitouClient")
        self.assertEqual(l["argv"][-2:], ["--renderer", "vulkan"])
        self.assertEqual(l["env"]["DYLD_LIBRARY_PATH"], "/x:/opt/homebrew/lib")
        self.assertEqual(l["env"]["MVK_CONFIG_USE_METAL_ARGUMENT_BUFFERS"], "1")
        self.assertEqual(l["unset"], [])

    def test_mac_vulkan_dir(self):
        have = {"/opt/homebrew/lib/libvulkan.1.dylib"}
        self.assertEqual(bench.find_mac_vulkan_dir({}, have.__contains__), "/opt/homebrew/lib")
        self.assertEqual(bench.find_mac_vulkan_dir({"VULKAN_SDK": "/sdk"}, {"/sdk/lib/libvulkan.1.dylib"}.__contains__), "/sdk/lib")
        self.assertEqual(bench.find_mac_vulkan_dir({}, lambda p: False), "")

    def test_key_plan(self):
        self.assertEqual(bench.key_plan("bases"), [("idle", 1, "2"), ("idle", 6, "1"), ("return", 1, "2"), ("return", 6, "1")])
        self.assertEqual(bench.key_plan("play"), [])

    def test_mangohud_config(self):
        c = bench.mangohud_config("/d", 60, "0000:01:00.0", "fps\nno_display=1\nlog_duration=5\n")
        self.assertIn("pci_dev=0000:01:00.0", c); self.assertIn("fps", c)
        self.assertNotIn("no_display", c); self.assertEqual(c.count("log_duration"), 1)
        self.assertEqual(bench.mh_pci_dev({}, [("0000:00:02.0", 0x030000, "0x8086"), ("0000:01:00.0", 0x030200, "0x10de")]), "0000:01:00.0")
        self.assertEqual(bench.mh_pci_dev({}, [("0000:01:00.0", 0x030200, "0x10de")]), "")
        self.assertEqual(bench.mh_pci_dev({"MH_PCI_DEV": "none"}, []), "")


class Keys(unittest.TestCase):
    def test_builders(self):
        self.assertEqual(kitkeys.ydotool_argv("2"), ["ydotool", "key", "3:1", "3:0", "3:1", "3:0"])
        self.assertEqual(kitkeys.ydotool_argv("1")[2], "2:1")
        self.assertEqual(kitkeys.xdotool_argv("2")[-2:], ["2", "2"])
        self.assertEqual(kitkeys.win_events("2"), [(3, 8), (3, 10), (3, 8), (3, 10)])
        self.assertEqual(kitkeys.mac_events("1"), [(0x12, True), (0x12, False), (0x12, True), (0x12, False)])
        self.assertIn("unix id is 42", kitkeys.mac_focus_argv(42)[-1])

    def test_choose(self):
        b, why = kitkeys.choose("linux", "none")
        self.assertIsNone(b); self.assertIn("disabled", why)
        self.assertIsInstance(kitkeys.choose("windows")[0] or kitkeys.WindowsKeys(), kitkeys.Backend)


class Build(unittest.TestCase):
    def test_publish(self):
        c = build.publish_command("osx-arm64", "p.csproj", "out", ["systemd-run", "--"])
        self.assertEqual(c, ["systemd-run", "--", "dotnet", "publish", "p.csproj", "-c", "Release", "-r", "osx-arm64", "--self-contained", "true", "-p:DebugType=embedded", "-o", "out"])
        self.assertEqual(build.post_publish_commands("win-x64", "out"), [])
        mac = build.post_publish_commands("osx-x64", "/nonexistent")
        self.assertEqual(mac[0], ["codesign", "--force", "--sign", "-", "/nonexistent/MeitouClient"]); self.assertEqual(mac[-1][0], "xattr")

    def test_targets(self):
        self.assertEqual(build.target_rids("host", "windows"), ["win-x64"])
        self.assertEqual(build.target_rids("both", "linux"), ["linux-x64", "win-x64"])
        self.assertEqual(build.target_rids("windows", "macos"), ["win-x64"])
        self.assertEqual(build.build_folder_name("Meitou-master", "osx-arm64"), "Meitou-master-osx-arm64")
        with self.assertRaises(K.KitError):
            build.target_rids("freebsd", "linux")


class Probes(unittest.TestCase):
    def test_windows(self):
        out = json.dumps({"cpu": "AMD Ryzen 5 5600 6-Core Processor   ", "ram": 34262020096, "os": "Microsoft Windows 11 Pro", "ver": "10.0.22631", "free_kb": 20971520,
                          "gpus": [{"name": "AMD Radeon(TM) Graphics", "driver": "31.0.1", "w": 1920, "h": 1080},
                                   {"name": "NVIDIA GeForce RTX 3060", "driver": "32.0.15.6094", "w": 1920, "h": 1080}]})
        d = K.hw_info("windows", run=lambda argv, timeout=20: out if argv[0] == "powershell" else "", env={})
        self.assertEqual((d["cpu"], d["ram_gb"], d["gpu"], d["gpu_driver"], d["os"], d["kernel"], d["display"], d["avail_mb"]),
                         ("AMD Ryzen 5 5600 6-Core Processor", "32", "NVIDIA GeForce RTX 3060", "32.0.15.6094", "Microsoft Windows 11 Pro", "10.0.22631", "1920x1080", 20480))

    def test_windows_empty(self):
        d = K.hw_info("windows", run=lambda *a, **k: "", env={})
        self.assertEqual(d["gpu"], "unknown"); self.assertIsNone(d["avail_mb"])

    def test_macos(self):
        sp = json.dumps({"SPDisplaysDataType": [{"sppci_model": "Apple M1 Pro", "spdisplays_mtlgpufamilysupport": "spdisplays_metal3",
                                                 "spdisplays_ndrvs": [{"_name": "Color LCD", "_spdisplays_pixels": "3024 x 1964"}]}]})
        vm = "Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:   1000.\nPages inactive:   2000.\nPages speculative:  500.\n"
        outs = {"sysctl -n machdep.cpu.brand_string": "Apple M1 Pro\n", "sysctl -n hw.memsize": "17179869184\n", "sw_vers -productName": "macOS\n",
                "sw_vers -productVersion": "15.1\n", "uname -r": "24.1.0\n", "vm_stat": vm}
        def run(argv, timeout=20):
            return sp if argv[0] == "system_profiler" else outs.get(" ".join(argv), "")
        d = K.hw_info("macos", run=run, env={})
        self.assertEqual((d["cpu"], d["ram_gb"], d["gpu"], d["os"], d["kernel"], d["display"], d["avail_mb"]),
                         ("Apple M1 Pro", "16", "Apple M1 Pro", "macOS 15.1", "24.1.0", "3024x1964", 3500 * 16384 // 1048576))
        self.assertEqual(d["gpu_driver"], "metal3")

    def test_linux(self):
        files = {"/proc/cpuinfo": "processor: 0\nmodel name\t: AMD Ryzen 7 6800HS\n", "/proc/meminfo": "MemTotal: 15728640 kB\nMemAvailable: 8388608 kB\n",
                 "/etc/os-release": 'NAME="Arch Linux"\nPRETTY_NAME="Arch Linux"\n'}
        def read(p):
            if p in files: return files[p]
            raise OSError(p)
        outs = {"nvidia-smi --query-gpu=name,driver_version --format=csv,noheader": "NVIDIA GeForce RTX 3070 Laptop GPU, 615.78.08\n", "uname -r": "7.3.0\n",
                "xrandr --current": "Screen 0\nDP-1 connected\n   2560x1440     59.95*+\n"}
        d = K.hw_info("linux", run=lambda argv, timeout=20: outs.get(" ".join(argv), ""), env={"GPU_DRIVER": "override"}, read=read)
        self.assertEqual((d["cpu"], d["ram_gb"], d["gpu"], d["gpu_driver"], d["os"], d["display"], d["avail_mb"]),
                         ("AMD Ryzen 7 6800HS", "15", "NVIDIA GeForce RTX 3070 Laptop GPU", "override", "Arch Linux", "2560x1440", 8192))

    def test_processes(self):
        self.assertEqual(K.game_process_lines("windows", run=lambda a, timeout=20: '"MeitouClient.exe","123","Console"\n"explorer.exe","4","Console"\n'),
                         ['"MeitouClient.exe","123","Console"'])
        self.assertTrue(K.game_process_lines("linux", run=lambda a, timeout=20: "  1 /sbin/init\n 99 ./MeitouClient --windowed\n"))
        self.assertFalse(K.game_process_lines("macos", run=lambda a, timeout=20: "  1 /sbin/launchd\n"))


class Save(unittest.TestCase):
    def test_verify(self):
        import hashlib
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "s", "sub")); pathlib.Path(d, "s", "sub", "a.txt").write_text("hi")
            h = hashlib.sha256(b"hi").hexdigest()
            pathlib.Path(d, "m").write_text(f"{h}  ./sub/a.txt\n")
            self.assertEqual(K.verify_save(os.path.join(d, "s"), os.path.join(d, "m")), (True, []))
            pathlib.Path(d, "s", "extra").write_text("x")
            ok, pr = K.verify_save(os.path.join(d, "s"), os.path.join(d, "m"))
            self.assertFalse(ok); self.assertEqual(pr, ["not in the manifest: extra"])


if __name__ == "__main__":
    unittest.main()
