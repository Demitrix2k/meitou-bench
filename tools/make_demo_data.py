#!/usr/bin/env python3
"""Write DEMO site data (data/demo/bench.json) from the real data/bench.json: three fake machines derived from the real rows, to test the
multi-machine views of the page. The fake data is for local testing only: data/demo/ is git-ignored, the page reads it only with ?demo=1 and
shows a "DEMO DATA" banner. Never commit or publish it.
Usage: python3 tools/make_demo_data.py [--in data/bench.json] [--out data/demo/bench.json]
Then: python3 -m http.server and open http://localhost:8000/?demo=1
"""
import argparse, copy, json, os, random

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

# id, name, cpu, gpu, ram, os, resolution, platform, os_family, speed factor (frame times), kept commits (index filter), breakdown?
FAKES = [
    dict(id="demo-windows-rtx4070", name="DEMO: Windows desktop, RTX 4070", cpu="DEMO Ryzen 7 7800X3D", gpu="DEMO NVIDIA GeForce RTX 4070",
         ram_gb=32, os="Windows 11 (demo)", resolution="1920x1080", platform="windows", os_family="windows", f=0.65, keep=lambda i, n: True, bd=True,
         notes="DEMO DATA: fake machine, values derived from the maintainer's rows. Full coverage, with stage timings."),
    dict(id="demo-steam-deck-proton", name="DEMO: Steam Deck, Proton", cpu="DEMO AMD Custom APU 0405", gpu="DEMO AMD Radeon Custom GPU 0405",
         ram_gb=16, os="Linux (SteamOS, demo)", resolution="1280x720", platform="proton", os_family="linux", f=2.4, keep=lambda i, n: i % 3 != 1, bd=False,
         notes="DEMO DATA: fake machine. Every third commit missing (coverage gaps), no stage timings (as an older kit would give)."),
    dict(id="demo-macbook-m2", name="DEMO: MacBook M2, macOS", cpu="DEMO Apple M2", gpu="DEMO Apple M2 (MoltenVK)",
         ram_gb=16, os="macOS 14 (demo)", resolution="2560x1600", platform="macos", os_family="macos", f=1.35, keep=lambda i, n: i >= n - 4, bd=True,
         notes="DEMO DATA: fake machine. Only the newest four commits."),
]


def scale_bd(bd, f, rnd):
    if not bd: return None
    return {k: {s: [round(v * f * rnd.uniform(0.9, 1.1), 3) for v in vs] for s, vs in d.items()} for k, d in bd.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", default=os.path.join(ROOT, "data", "bench.json"))
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "demo", "bench.json"))
    a = ap.parse_args()
    doc = json.load(open(a.src, encoding="utf-8"))
    real = [r for r in doc["rows"]]
    base_m = doc["machines"][0]["id"]
    order = [c["commit"] for c in doc["commits"]]
    benched = [c for c in order if any(r["commit"] == c for r in real)]
    rnd = random.Random(42)
    rows, machines = list(real), list(doc["machines"])
    for fk in FAKES:
        mrows = 0
        keep = {c for i, c in enumerate(benched) if fk["keep"](i, len(benched))}
        for r in real:
            if r["machine"] != base_m or r["commit"] not in keep: continue
            n = copy.deepcopy(r)
            f = fk["f"]
            m = n["metrics"]
            for k in ("p50_ms", "p99_ms", "max_ms", "slow_world_p99_ms", "slow_world_max_ms"):
                m[k] = round(m[k] * f * rnd.uniform(0.9, 1.12), 1)
            m["over33_pct"] = round(min(100.0, m["over33_pct"] * f * f * rnd.uniform(0.8, 1.2)), 1)
            m["over100_count"] = int(round(m["over100_count"] * f * rnd.uniform(0.7, 1.3)))
            n["breakdown"] = scale_bd(r.get("breakdown"), f, rnd) if fk["bd"] else None
            n.update(machine=fk["id"], platform=fk["platform"], gpu=fk["gpu"], driver="demo", note="DEMO DATA, not a real result")
            rows.append(n); mrows += 1
        mm = dict(id=fk["id"], github="", name=fk["name"], cpu=fk["cpu"], gpu=fk["gpu"], ram_gb=fk["ram_gb"], os=fk["os"], resolution=fk["resolution"],
                  notes=fk["notes"], added="2026-10-29", platform=fk["platform"], os_family=fk["os_family"], maintainer=False)
        ds = [r for r in rows if r["machine"] == fk["id"]]
        mm.update(commit_count=len({r["commit"] for r in ds}), last_date=max(r["date"] for r in ds), first_date=min(r["date"] for r in ds))
        machines.append(mm)
    for t in doc["targets"]:
        t["machines"] = sorted({r["machine"] for r in rows if r["target"] == t["commit"]})
    doc.update(rows=rows, machines=machines, demo=True)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump(doc, open(a.out, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print("wrote %s: %d machines, %d rows (DEMO DATA, never publish)" % (a.out, len(machines), len(rows)))


if __name__ == "__main__":
    main()
