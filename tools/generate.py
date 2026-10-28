#!/usr/bin/env python3
"""Build data/bench.json from a daily-bench CSV and a clone of the upstream repo.

Usage: python3 tools/generate.py --csv path/to/daily-bench.csv --repo path/to/MeitouClient
The upstream clone is only read (git log / rev-parse). Output is deterministic,
so rerunning on the same inputs rewrites an identical file.
"""
import argparse, csv, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

METRICS = {  # public name -> CSV column
    "over33_pct": "frames_over_33ms_pct",
    "p50_ms": "p50_ms",
    "p99_ms": "p99_ms",
    "max_ms": "max_ms",
    "over100_count": "frames_over_100ms",
    "slow_world_p99_ms": "slow_world_p99_ms",
    "slow_world_max_ms": "slow_world_max_ms",
}


def git(repo, *args):
    r = subprocess.run(["git", "-C", repo] + list(args), capture_output=True, text=True)
    if r.returncode != 0:
        return None
    return r.stdout


def num(s):
    try:
        v = float(s)
    except (TypeError, ValueError):
        return None
    return int(v) if v == int(v) and "." not in s else v


def clean_note(n, run):
    """Keep only short notes; drop anything about other rows/times or saves."""
    n = re.sub(r";?\s*save \S+", "", n or "").strip(" ;")
    if run > 1 or re.search(r"\b(row|extra run|\d\d:\d\d)\b", n):
        return ""
    return n


def bucket_of(subject, cfg):
    """Use the text before ':' (or the whole subject if none) and take the
    longest configured key that equals it or starts it at a word boundary."""
    low = subject.lower()
    for kw, b in cfg.get("keyword_buckets", {}).items():
        if kw in low:
            return b
    text = subject.split(":", 1)[0] if ":" in subject else subject
    text = text.strip().lower()
    best = None
    for k, b in cfg["prefix_buckets"].items():
        if (text == k or text.startswith(k + " ")) and (best is None or len(k) > len(best[0])):
            best = (k, b)
    return best[1] if best else "Other"


MERGE_RE = re.compile(r"^Merge (?:PR|pull request) #?(\d+)(?::\s*(.*?))?(?:\s+from\s+\S+)?(?:\s+\(by ([^)]+)\))?$")


def changes(repo, prev, cur, cfg):
    rng = prev + ".." + cur
    out = git(repo, "log", "--no-merges", "--format=%H%x09%s", rng)
    if out is None:
        return None
    commits = []
    for line in out.splitlines():
        h, _, s = line.partition("\t")
        commits.append({"hash": h, "short": h[:8], "subject": s, "bucket": bucket_of(s, cfg)})
    prs = []
    mout = git(repo, "log", "--merges", "--format=%H%x09%s", rng) or ""
    for line in mout.splitlines():
        h, _, s = line.partition("\t")
        m = MERGE_RE.match(s)
        if m:
            prs.append({"number": int(m.group(1)), "title": (m.group(2) or "").strip(),
                        "author": m.group(3) or "", "hash": h})
    counts = {b: 0 for b in cfg["buckets"]}
    for c in commits:
        counts[c["bucket"]] += 1
    return {"since": prev, "commit_count": len(commits), "bucket_counts": counts,
            "commits": commits, "merged_prs": prs}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--config", default=os.path.join(ROOT, "series.json"))
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "bench.json"))
    a = ap.parse_args()
    cfg = json.load(open(a.config, encoding="utf-8"))

    with open(a.csv, newline="", encoding="utf-8") as f:
        raw = list(csv.DictReader(f))
    raw.sort(key=lambda r: (r["date"], r["time"]))

    series = sorted(cfg["series"], key=lambda s: s["start"])

    def series_of(ts):
        sid = None
        for s in series:
            if s["start"] <= ts:
                sid = s["id"]
        return sid

    full = {}
    def full_hash(short):
        if short not in full:
            o = git(a.repo, "rev-parse", "--verify", short + "^{commit}")
            full[short] = o.strip() if o else None
        return full[short]

    counter = {}
    rows, order = [], []
    for r in raw:
        seg = r["segments"]
        sc = cfg["scenarios"].get(seg)
        if not sc:
            print("warning: unknown segments %r, row skipped" % seg, file=sys.stderr)
            continue
        key = (r["commit"], sc["id"], r.get("machine") or cfg["default_machine"])
        counter[key] = counter.get(key, 0) + 1
        if r["commit"] not in order:
            order.append(r["commit"])
        ts = r["date"] + " " + r["time"]
        rows.append({
            "date": r["date"], "time": r["time"], "commit": r["commit"],
            "commit_full": full_hash(r["commit"]), "scenario": sc["id"],
            "run": counter[key],
            "metrics": {k: num(r[c]) for k, c in METRICS.items() if c in r},
            "gpu": r["gpu"], "driver": r["nvidia_driver"],
            "machine": r.get("machine") or cfg["default_machine"],
            "series": series_of(ts), "note": clean_note(r.get("note"), counter[key]),
        })

    commits = []
    for i, c in enumerate(order):
        first = next(x for x in rows if x["commit"] == c)
        entry = {"commit": c, "commit_full": first["commit_full"], "date": first["date"],
                 "time": first["time"], "series": first["series"], "changes": None,
                 "first_benchmark": i == 0}
        if i > 0 and first["commit_full"]:
            prev_full = next(x for x in rows if x["commit"] == order[i - 1])["commit_full"]
            if prev_full:
                entry["changes"] = changes(a.repo, prev_full, first["commit_full"], cfg)
                if entry["changes"]:
                    entry["changes"]["since"] = order[i - 1]
        commits.append(entry)

    doc = {
        "repo_url": cfg["repo_url"],
        "machines": cfg["machines"],
        "series": series,
        "scenarios": {v["id"]: {"title": v["title"], "subtitle": v["subtitle"], "segments": k}
                      for k, v in cfg["scenarios"].items()},
        "buckets": cfg["buckets"],
        "commits": commits,
        "rows": rows,
    }
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print("wrote %s: %d rows, %d commits" % (os.path.relpath(a.out), len(rows), len(commits)))


if __name__ == "__main__":
    main()
