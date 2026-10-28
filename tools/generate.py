#!/usr/bin/env python3
"""Build data/bench.json from data/machines/*.json and data/results/<machine>/*.csv.

Usage:
  python3 tools/generate.py --repo path/to/MeitouClient            # validate and write data/bench.json
  python3 tools/generate.py --repo path/to/MeitouClient --check    # validate only (CI)

--repo is a clone of the upstream repository (only read: git rev-list / rev-parse / log).
--ref  is the upstream branch that defines commit order (default origin/master).
Commits are ordered by upstream history (git rev-list --topo-order), not by benchmark
date, and a commit that is not on --ref is rejected. Invalid input prints every problem
and exits 1; nothing is written then. Output is deterministic.
"""
import argparse, csv, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

SAVE = "bench-bases-2026-10-27"
DATA = "gog"
PLATFORMS = ("native", "proton")
MAX_RUNS = 2

METRICS = {  # public name -> CSV column
    "over33_pct": "frames_over_33ms_pct",
    "p50_ms": "p50_ms",
    "p99_ms": "p99_ms",
    "max_ms": "max_ms",
    "over100_count": "frames_over_100ms",
    "slow_world_p99_ms": "slow_world_p99_ms",
    "slow_world_max_ms": "slow_world_max_ms",
}
REQUIRED_COLS = ["date", "time", "commit", "platform", "data", "save", "segments", "run"] + \
    list(METRICS.values()) + ["gpu", "nvidia_driver"]
MACHINE_REQUIRED = ["id", "github", "cpu", "gpu", "ram_gb", "os", "resolution", "added"]
MACHINE_OPTIONAL = ["name", "notes"]
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$")
HANDLE_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$")
DATE_RE = re.compile(r"^\d{4}-\d\d-\d\d$")
TIME_RE = re.compile(r"^\d\d:\d\d:\d\d$")
RES_RE = re.compile(r"^\d{3,5}x\d{3,5}$")
HASH_RE = re.compile(r"^[0-9a-f]{7,40}$")
RESULT_RE = re.compile(r"^(\d{4}-\d\d-\d\d)-([0-9a-f]{7,40})\.csv$")
REPORT_RE = re.compile(r"^(\d{4}-\d\d-\d\d)-([0-9a-f]{7,40})\.report\.md$")
KIT_NOTE_RE = re.compile(r"series \d+: \d+ runs per scenario \(run 1 may be cache-cold\); dev kit;?\s*")


def git(repo, *args):
    r = subprocess.run(["git", "-C", repo] + list(args), capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def num(s):
    try:
        v = float(s)
    except (TypeError, ValueError):
        return None
    if v != v or v in (float("inf"), float("-inf")):
        return None
    return int(v) if v == int(v) and "." not in s else v


def clean_note(n, run):
    """Keep only short notes; drop anything about other rows/times or saves."""
    n = KIT_NOTE_RE.sub("", n or "")
    n = re.sub(r";?\s*save \S+", "", n).strip(" ;")
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


IDENTICAL_DIRS = ("docs/", "site/", "tests/", ".github/", "tools/")


def code_identical(repo, a, b):
    """True when only docs/, site/, tests/, .github/, tools/ or *.md files differ between a and b."""
    if a == b:
        return True
    out = git(repo, "diff", "--name-only", a, b)
    if out is None:
        return False
    return all(p.startswith(IDENTICAL_DIRS) or p.endswith(".md") for p in out.splitlines() if p)


def load_targets(path, repo, position, errors, warnings):
    """Read targets.json: ordered list of {commit, date, label, kind, note}; latest = current standard."""
    out = []
    try:
        raw = json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError) as e:
        errors.append("%s: cannot read (%s)" % (os.path.relpath(path, ROOT), e))
        return out
    rel = os.path.relpath(path, ROOT)
    if not isinstance(raw, list) or not raw:
        errors.append("%s: must be a non-empty JSON list" % rel)
        return out
    last = -1
    for i, t in enumerate(raw):
        where = "%s entry %d" % (rel, i + 1)
        if not isinstance(t, dict) or not all(isinstance(t.get(k), str) for k in ("commit", "date", "label", "kind")):
            errors.append("%s: needs text fields commit, date, label, kind (and note)" % where)
            continue
        if not re.match(r"^[0-9a-f]{8}$", t["commit"]):
            errors.append("%s: commit %r must be 8 lowercase hex digits" % (where, t["commit"]))
            continue
        if not DATE_RE.match(t["date"]):
            errors.append("%s: date must be YYYY-MM-DD" % where)
        if t["kind"] not in ("release", "daily"):
            errors.append("%s: kind must be release or daily" % where)
        if not t["label"].strip():
            errors.append("%s: label is empty" % where)
        h = git(repo, "rev-parse", "--verify", "--quiet", t["commit"] + "^{commit}")
        h = h.strip() if h else None
        if not h or h not in position:
            errors.append("%s: commit %s is not on upstream master" % (where, t["commit"]))
            continue
        if position[h] <= last:
            errors.append("%s: targets must be in upstream order, oldest first (%s is not newer than the one before)" % (where, t["commit"]))
        last = max(last, position[h])
        if t["kind"] == "release" and re.match(r"^v?\d+(\.\d+)+", t["label"]):
            tag = git(repo, "rev-parse", "--verify", "--quiet", "refs/tags/" + t["label"] + "^{commit}")
            if tag is None or not tag.strip():
                warnings.append("%s: no upstream tag %s to check the label against" % (where, t["label"]))
            elif not code_identical(repo, tag.strip(), h):
                errors.append("%s: label %s (tag at %s) is not code-identical to commit %s (more than docs/site/tests/.github/tools/*.md differ)"
                              % (where, t["label"], tag.strip()[:8], t["commit"]))
        out.append({"commit": t["commit"], "commit_full": h, "date": t["date"], "label": t["label"],
                    "kind": t["kind"], "note": t.get("note", "")})
    return out


def load_machines(data_dir, errors):
    machines = {}
    mdir = os.path.join(data_dir, "machines")
    if not os.path.isdir(mdir):
        errors.append("%s: folder missing" % mdir)
        return machines
    for fn in sorted(os.listdir(mdir)):
        path = os.path.join(mdir, fn)
        rel = os.path.relpath(path, ROOT)
        if not fn.endswith(".json"):
            errors.append("%s: only <machine-id>.json files belong here" % rel)
            continue
        try:
            m = json.load(open(path, encoding="utf-8"))
        except (ValueError, OSError) as e:
            errors.append("%s: not valid JSON (%s)" % (rel, e))
            continue
        if not isinstance(m, dict):
            errors.append("%s: must be a JSON object" % rel)
            continue
        bad = False
        def err(msg):
            nonlocal bad
            bad = True
            errors.append("%s: %s" % (rel, msg))
        for k in m:
            if k not in MACHINE_REQUIRED + MACHINE_OPTIONAL:
                err("unknown field %r" % k)
        for k in MACHINE_REQUIRED:
            if m.get(k) in (None, ""):
                err("missing field %r" % k)
        stem = fn[:-5]
        if m.get("id") != stem:
            err("id %r must equal the file name %r" % (m.get("id"), stem))
        if not ID_RE.match(stem):
            err("machine id %r must be 3-48 characters: lowercase letters, digits, hyphens" % stem)
        if m.get("github") and not HANDLE_RE.match(str(m["github"])):
            err("github %r is not a GitHub handle (no @, no URL)" % m["github"])
        if m.get("ram_gb") not in (None, "") and not (isinstance(m["ram_gb"], (int, float)) and not isinstance(m["ram_gb"], bool) and m["ram_gb"] > 0):
            err("ram_gb must be a positive number")
        if m.get("resolution") and not RES_RE.match(str(m["resolution"])):
            err("resolution %r must look like 2560x1406" % m["resolution"])
        if m.get("added") and not DATE_RE.match(str(m["added"])):
            err("added %r must be YYYY-MM-DD" % m["added"])
        for k in ("cpu", "gpu", "os", "name", "notes"):
            if k in m and not isinstance(m[k], str):
                err("%s must be text" % k)
        if not bad:
            machines[stem] = m
    return machines


def read_results(data_dir, machines, errors):
    """Return (rows, results_dirs_seen). Each row: dict of CSV fields + machine, file."""
    rows = []
    rdir = os.path.join(data_dir, "results")
    if not os.path.isdir(rdir):
        errors.append("%s: folder missing" % rdir)
        return rows
    for mid in sorted(os.listdir(rdir)):
        mpath = os.path.join(rdir, mid)
        if not os.path.isdir(mpath):
            errors.append("%s: only machine folders belong in data/results/" % os.path.relpath(mpath, ROOT))
            continue
        if mid not in machines:
            errors.append("%s: no data/machines/%s.json (add the machine file first)" % (os.path.relpath(mpath, ROOT), mid))
            continue
        for fn in sorted(os.listdir(mpath)):
            path = os.path.join(mpath, fn)
            rel = os.path.relpath(path, ROOT)
            fname_commit = None
            if fn == "daily-bench.csv":
                pass
            elif RESULT_RE.match(fn):
                fname_commit = RESULT_RE.match(fn).group(2)
            elif REPORT_RE.match(fn):
                continue
            else:
                errors.append("%s: file name must be <YYYY-MM-DD>-<commit>.csv (optional <YYYY-MM-DD>-<commit>.report.md)" % rel)
                continue
            read_csv(path, rel, mid, fname_commit, rows, errors)
    return rows


def read_csv(path, rel, mid, fname_commit, rows, errors):
    n0 = len(errors)
    def err(line, msg):
        errors.append("%s%s: %s" % (rel, (" line %d" % line) if line else "", msg))
    try:
        with open(path, newline="", encoding="utf-8") as f:
            rd = csv.DictReader(f)
            header = rd.fieldnames or []
            missing = [c for c in REQUIRED_COLS if c not in header]
            if missing:
                err(0, "missing column(s): %s" % ", ".join(missing))
                return
            recs = list(enumerate(rd, start=2))
    except (OSError, UnicodeDecodeError, csv.Error) as e:
        err(0, "cannot read (%s)" % e)
        return
    if not recs:
        err(0, "no data rows")
        return
    for ln, r in recs:
        if None in r:
            err(ln, "more fields than the header has columns")
            continue
        r = {k: (v if v is not None else "") for k, v in r.items()}
        bad = False
        def e(msg):
            nonlocal bad
            bad = True
            err(ln, msg)
        if not DATE_RE.match(r["date"]):
            e("date %r must be YYYY-MM-DD" % r["date"])
        if not TIME_RE.match(r["time"]):
            e("time %r must be HH:MM:SS" % r["time"])
        if not HASH_RE.match(r["commit"]):
            e("commit %r must be 7-40 lowercase hex digits" % r["commit"])
        elif fname_commit and not (r["commit"].startswith(fname_commit) or fname_commit.startswith(r["commit"])):
            e("commit %s does not match the file name (%s)" % (r["commit"], fname_commit))
        if r["platform"] not in PLATFORMS:
            e("platform %r must be one of %s" % (r["platform"], "/".join(PLATFORMS)))
        if r["data"] != DATA:
            e("data is %r; only clean unmodded data (%s) is accepted" % (r["data"], DATA))
        if r["save"] != SAVE:
            e("save is %r; only %s is accepted" % (r["save"], SAVE))
        if r["segments"] not in SEGMENTS:
            e("unknown segments %r (expected one of: %s)" % (r["segments"], "; ".join(SEGMENTS)))
        for k, c in METRICS.items():
            v = num(r[c])
            if v is None or v < 0:
                e("%s %r is not a non-negative number" % (c, r[c]))
        if r.get("machine") not in (None, "") and r["machine"] != mid:
            e("machine column %r does not match the folder %r" % (r["machine"], mid))
        if not r["gpu"].strip():
            e("gpu is empty")
        if not bad:
            r["machine"] = mid
            r["_file"] = rel
            r["_line"] = ln
            rows.append(r)


SEGMENTS = {}  # filled from series.json in main()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True, help="clone of the upstream repository")
    ap.add_argument("--ref", default="origin/master", help="upstream branch that defines commit order")
    ap.add_argument("--check", action="store_true", help="validate only, write nothing")
    ap.add_argument("--append-targets", action="store_true",
                    help="maintainer: add the maintainer's newer benchmarked commits to targets.json as daily targets (skips commits code-identical to the latest target)")
    ap.add_argument("--data", default=os.path.join(ROOT, "data"))
    ap.add_argument("--targets", default=os.path.join(ROOT, "targets.json"))
    ap.add_argument("--config", default=os.path.join(ROOT, "series.json"))
    ap.add_argument("--out", default=None, help="default <data>/bench.json")
    a = ap.parse_args()
    out_path = a.out or os.path.join(a.data, "bench.json")
    cfg = json.load(open(a.config, encoding="utf-8"))
    SEGMENTS.update(cfg["scenarios"])
    errors, warnings = [], []

    machines = load_machines(a.data, errors)
    rows_raw = read_results(a.data, machines, errors)

    # upstream order
    order_out = git(a.repo, "rev-list", "--topo-order", a.ref)
    if order_out is None:
        print("error: cannot read history of %s in %s" % (a.ref, a.repo), file=sys.stderr)
        sys.exit(2)
    position = {h: i for i, h in enumerate(reversed(order_out.split()))}

    targets = load_targets(a.targets, a.repo, position, errors, warnings)
    full = {}
    for r in rows_raw:
        c = r["commit"]
        if c not in full:
            o = git(a.repo, "rev-parse", "--verify", "--quiet", c + "^{commit}")
            full[c] = o.strip() if o else None
        if full[c] is None:
            errors.append("%s line %d: commit %s does not exist in the upstream repository" % (r["_file"], r["_line"], c))
        elif full[c] not in position:
            errors.append("%s line %d: commit %s is not on upstream %s" % (r["_file"], r["_line"], c, a.ref))
    # one commit, one short name
    short = {}
    for c, h in full.items():
        if h:
            short.setdefault(h, c[:8])

    rows_raw = [r for r in rows_raw if full.get(r["commit"]) in position]
    rows_raw.sort(key=lambda r: (r["date"], r["time"], r["machine"]))

    series = sorted(cfg["series"], key=lambda s: s["start"])
    maint = cfg["maintainer_machine"]

    def series_of(r):
        if r["machine"] == maint:
            ts, sid = r["date"] + " " + r["time"], None
            for s in series:
                if s["start"] <= ts:
                    sid = s["id"]
            return sid
        m = re.match(r"series (\d+)\b", r.get("note", ""))
        return int(m.group(1)) if m else None

    counter, seen, rows = {}, set(), []
    platforms = {}
    for r in rows_raw:
        sc = cfg["scenarios"][r["segments"]]
        ident = (r["machine"], r["date"], r["time"], r["commit"], sc["id"])
        if ident in seen:
            errors.append("%s line %d: duplicate row (same machine, time, commit and scenario)" % (r["_file"], r["_line"]))
            continue
        seen.add(ident)
        platforms.setdefault(r["machine"], set()).add(r["platform"])
        key = (r["machine"], full[r["commit"]], sc["id"])
        counter[key] = counter.get(key, 0) + 1
        if counter[key] > MAX_RUNS:
            errors.append("%s line %d: more than %d runs of %s for commit %s on machine %s (send the best two, or put the rest in the note)"
                          % (r["_file"], r["_line"], MAX_RUNS, sc["id"], r["commit"], r["machine"]))
        h = full[r["commit"]]
        rows.append({
            "date": r["date"], "time": r["time"], "commit": short[h], "commit_full": h,
            "scenario": sc["id"], "run": counter[key],
            "metrics": {k: num(r[c]) for k, c in METRICS.items()},
            "gpu": r["gpu"], "driver": r["nvidia_driver"], "machine": r["machine"],
            "platform": r["platform"], "series": series_of(r),
            "note": clean_note(r.get("note"), counter[key]),
        })
    for mid, ps in sorted(platforms.items()):
        if len(ps) > 1:
            errors.append("data/results/%s: rows for both native and proton; use a separate machine id for each" % mid)

    for mid in machines:
        if mid not in platforms:
            warnings.append("machine %s has no results yet; it is not shown on the page" % mid)
    if maint not in machines:
        errors.append("maintainer machine %s (series.json) has no data/machines/%s.json" % (maint, maint))

    if a.append_targets and not a.check and targets:
        added = []
        last_pos = max(position[t["commit_full"]] for t in targets)
        mine = sorted({r["commit_full"] for r in rows if r["machine"] == maint}, key=lambda h: position[h])
        for h in mine:
            if position[h] <= last_pos or code_identical(a.repo, (targets + added)[-1]["commit_full"], h):
                continue
            first = min((r for r in rows if r["commit_full"] == h and r["machine"] == maint), key=lambda r: (r["date"], r["time"]))
            label = "daily " + first["date"]
            n = sum(1 for t in targets + added if t["label"].startswith(label))
            if n:
                label += " (%d)" % (n + 1)
            added.append({"commit": short[h], "commit_full": h, "date": first["date"], "label": label, "kind": "daily", "note": ""})
        if added:
            targets.extend(added)
            with open(a.targets, "w", encoding="utf-8") as f:
                f.write("[\n" + ",\n".join("  " + json.dumps({k: t[k] for k in ("commit", "date", "label", "kind", "note")}, ensure_ascii=False) for t in targets) + "\n]\n")
            print("targets.json: added %s" % ", ".join(t["commit"] for t in added))

    # which target does each benchmarked commit count for? (itself, or a code-identical target)
    target_of = {}
    for h in {r["commit_full"] for r in rows}:
        hit = next((t for t in targets if t["commit_full"] == h), None)
        if not hit:
            hit = next((t for t in reversed(targets) if code_identical(a.repo, t["commit_full"], h)), None)
        target_of[h] = hit
    for r in rows:
        t = target_of[r["commit_full"]]
        r["target"] = t["commit"] if t else None
    for h, t in sorted(target_of.items(), key=lambda kv: position[kv[0]]):
        if t is None:
            warnings.append("off-target: commit %s is on upstream master but is not a benchmark target (nor code-identical to one); accepted, shown faded, left out of cross-machine comparisons" % short[h])
            if os.environ.get("GITHUB_ACTIONS"):
                print("::warning::off-target commit %s (not a benchmark target)" % short[h])

    for w in warnings:
        print("warning: " + w, file=sys.stderr)
    if errors:
        print("%d problem(s) found:" % len(errors), file=sys.stderr)
        for e in errors:
            print("  - " + e, file=sys.stderr)
        sys.exit(1)

    # commits in upstream order, with change lists between consecutive benchmarked commits
    by_commit = {}
    for r in rows:
        by_commit.setdefault(r["commit_full"], []).append(r)
    ordered = sorted(by_commit, key=lambda h: position[h])
    commits = []
    for i, h in enumerate(ordered):
        rs = sorted(by_commit[h], key=lambda r: (r["date"], r["time"]))
        mrs = [r for r in rs if r["machine"] == maint] or rs
        entry = {"commit": short[h], "commit_full": h, "date": rs[0]["date"], "time": rs[0]["time"],
                 "series": mrs[0]["series"], "changes": None, "first_benchmark": i == 0}
        t = target_of[h]
        entry["target"] = t["commit"] if t else None
        entry["target_exact"] = bool(t and t["commit_full"] == h)
        entry["off_target"] = t is None
        if i > 0:
            entry["changes"] = changes(a.repo, ordered[i - 1], h, cfg)
            if entry["changes"]:
                entry["changes"]["since"] = short[ordered[i - 1]]
        commits.append(entry)

    mlist = []
    for mid in sorted(platforms, key=lambda m: (m != maint, m)):
        m = dict(machines[mid])
        mrows = [r for r in rows if r["machine"] == mid]
        m["platform"] = next(iter(platforms[mid]))
        m["commit_count"] = len({r["commit"] for r in mrows})
        m["last_date"] = max(r["date"] for r in mrows)
        m["first_date"] = min(r["date"] for r in mrows)
        m["maintainer"] = mid == maint
        for k in MACHINE_OPTIONAL:
            m.setdefault(k, "")
        mlist.append(m)

    tlist = []
    for t in targets:
        d = {k: v for k, v in t.items() if k != "commit_full"}
        d["commit_full"] = t["commit_full"]
        d["machines"] = sorted({r["machine"] for r in rows if r["target"] == t["commit"]})
        d["variants"] = sorted({short[r["commit_full"]] for r in rows if r["target"] == t["commit"] and r["commit_full"] != t["commit_full"]})
        tlist.append(d)
    doc = {
        "targets": tlist,
        "repo_url": cfg["repo_url"],
        "machines": mlist,
        "series": series,
        "scenarios": {v["id"]: {"title": v["title"], "subtitle": v["subtitle"], "segments": k}
                      for k, v in cfg["scenarios"].items()},
        "buckets": cfg["buckets"],
        "commits": commits,
        "rows": rows,
    }
    if a.check:
        print("ok: %d machine(s), %d rows, %d commits" % (len(mlist), len(rows), len(commits)))
        return
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print("wrote %s: %d machine(s), %d rows, %d commits" % (os.path.relpath(out_path), len(mlist), len(rows), len(commits)))


if __name__ == "__main__":
    main()
