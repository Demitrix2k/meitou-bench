(function () {
  "use strict";
  var REPO = "https://github.com/VlcekM/MeitouClient";
  var METRICS = [
    { key: "over33_pct", label: "Frames over 33 ms (%)", unit: "%" },
    { key: "p99_ms", label: "p99 frame time (ms)", unit: " ms" },
    { key: "p50_ms", label: "p50 frame time (ms)", unit: " ms" },
    { key: "slow_world_p99_ms", label: "Slow-world tick p99 (ms)", unit: " ms" }
  ];
  var ALLM = METRICS.concat([
    { key: "max_ms", label: "Max frame (ms)", unit: " ms" },
    { key: "over100_count", label: "Frames over 100 ms", unit: "" },
    { key: "slow_world_max_ms", label: "Slow-world tick max (ms)", unit: " ms" }
  ]);
  var NS = "http://www.w3.org/2000/svg";
  var D = null;
  var state = { selected: {}, runMode: "warm", relative: false, ref: "" };
  var tip = document.getElementById("tip");

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in (attrs || {})) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function sv(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    for (var k in (attrs || {})) e.setAttribute(k, attrs[k]);
    return e;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }
  function linkify(s) {
    return esc(s).replace(/#(\d+)/g, '<a href="' + REPO + '/pull/$1">#$1</a>');
  }
  function fmt(v) {
    if (v == null) return "n/a";
    return Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  }
  function short(c) { return c.slice(0, 8); }
  function mname(m) { return m.name || m.id; }
  // Platform of a machine: native = the Linux build on Linux, proton = the Windows build under Proton on Linux.
  var PLAT = { native: "Linux native", proton: "Linux Proton", windows: "Windows", macos: "macOS" };
  function platLabel(m) { return PLAT[m.platform] || m.platform; }
  function platChip(m) { return '<span class="chip plat plat-' + esc(m.platform) + '" title="platform of this machine\'s runs">' + esc(platLabel(m)) + "</span>"; }
  function mcolor(m) { return "var(--m" + (D.machines.indexOf(m) % 8) + ")"; }
  function mdot(m) { return '<span class="dot" style="background:' + mcolor(m) + '"></span>'; }
  function handleLink(m) {
    return '<a href="https://github.com/' + encodeURIComponent(m.github) + '">@' + esc(m.github) + "</a>";
  }
  function machineById(id) { return D.machines.filter(function (m) { return m.id === id; })[0]; }
  function selectedMachines() { return D.machines.filter(function (m) { return state.selected[m.id]; }); }
  function multi() { return D.machines.length > 1; }

  function rowsFor(m, commit, scen) {
    return D.rows.filter(function (r) {
      return r.commit === commit && r.scenario === scen && r.machine === m.id;
    }).sort(function (a, b) { return a.run - b.run; });
  }
  // Rows of one machine that count for a target (the target commit itself, else a code-identical variant).
  function targetRows(m, t, scen) {
    var rs = D.rows.filter(function (r) { return r.machine === m.id && r.scenario === scen && r.target === t.commit; });
    var ex = rs.filter(function (r) { return r.commit_full === t.commit_full; }), use = ex.length ? ex : rs;
    if (!use.length) return [];
    return use.filter(function (r) { return r.commit === use[0].commit; }).sort(function (a, b) { return a.run - b.run; });
  }
  function currentTarget() { return D.targets[D.targets.length - 1]; }
  function commitsShown() {
    var sel = selectedMachines().map(function (m) { return m.id; });
    return D.commits.filter(function (c) {
      return D.rows.some(function (r) { return r.commit === c.commit && sel.indexOf(r.machine) >= 0; });
    });
  }
  function seriesName(id) {
    var s = D.series.filter(function (x) { return x.id === id; })[0];
    return s ? s.label : id == null ? "no series" : "Series " + id;
  }
  // The runs of one (machine, commit, scenario) that the run selector wants drawn.
  function pick(rs) {
    var r1 = rs.filter(function (r) { return r.run === 1; })[0], r2 = rs.filter(function (r) { return r.run === 2; })[0];
    if (state.runMode === "run1") return r1 ? [r1] : [];
    if (state.runMode === "both") return [r1, r2].filter(Boolean);
    return r2 ? [r2] : r1 ? [r1] : [];
  }

  function showTip(html, ev) {
    tip.innerHTML = html; tip.hidden = false;
    var w = tip.offsetWidth, x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
    if (y + tip.offsetHeight > window.innerHeight - 8) y = ev.clientY - tip.offsetHeight - 14;
    tip.style.left = Math.max(4, x) + "px"; tip.style.top = Math.max(4, y) + "px";
  }
  function hideTip() { tip.hidden = true; }

  function niceTicks(v) {
    if (v <= 0) v = 1;
    var raw = v / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
    var st = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p, out = [];
    for (var x = 0; x < v + st * 0.999; x += st) out.push(Math.round(x / st * 1e6) / 1e6 * st);
    return out;
  }

  // Reference value for relative mode: this machine's value at its reference commit.
  function baseValue(m, scen, key, run) {
    var refs = state.ref ? D.targets.filter(function (t) { return t.commit === state.ref; }) : D.targets;
    for (var i = 0; i < refs.length; i++) {
      var rs = targetRows(m, refs[i], scen).filter(function (r) { return r.metrics[key] != null; });
      if (!rs.length) continue;
      var same = rs.filter(function (r) { return r.run === run; })[0];
      var r = same || rs[rs.length - 1];
      return r.metrics[key];
    }
    return null;
  }

  function chart(host, metric, scen, commits) {
    var box = el("div", { class: "chart" });
    box.appendChild(el("h3", {}, metric.label + (state.relative ? " - % of own baseline" : "")));
    host.appendChild(box);
    var W = Math.max(240, Math.floor(box.clientWidth - 20)), H = 250;
    var m = { l: 46, r: 26, t: 14, b: 48 };
    var pw = W - m.l - m.r, ph = H - m.t - m.b;
    var svg = sv("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img",
      "aria-label": metric.label + " per benchmarked commit" });
    var n = commits.length;

    // collect points per machine and line group
    var lines = [], max = 0;
    selectedMachines().forEach(function (mc) {
      var groups = {};
      commits.forEach(function (c, i) {
        pick(rowsFor(mc, c.commit, scen)).forEach(function (r) {
          var v = r.metrics[metric.key];
          if (v == null) return;
          var rel = null;
          if (state.relative) {
            var b = baseValue(mc, scen, metric.key, r.run);
            if (b == null || b === 0) return;
            rel = v / b * 100;
          }
          var shown = state.relative ? rel : v;
          if (shown > max) max = shown;
          var g = state.runMode === "both" ? r.run : 0;
          (groups[g] = groups[g] || []).push({ i: i, c: c, r: r, v: v, shown: shown, m: mc, off: !!c.off_target });
        });
      });
      Object.keys(groups).forEach(function (g) { lines.push({ m: mc, g: +g, pts: groups[g] }); });
    });
    if (state.relative && max < 110) max = 110;
    var tk = niceTicks(max);
    max = tk[tk.length - 1];
    function X(i) { return m.l + (n === 1 ? pw / 2 : (pw * i) / (n - 1)); }
    function Y(v) { return m.t + ph - (v / max) * ph; }
    for (var g = 0; g < tk.length; g++) {
      var gv = tk[g], gy = Y(gv);
      svg.appendChild(sv("line", { class: "grid", x1: m.l, x2: W - m.r, y1: gy, y2: gy }));
      var t = sv("text", { x: m.l - 5, y: gy + 4, "text-anchor": "end" });
      t.textContent = fmt(gv) + (state.relative ? "%" : ""); svg.appendChild(t);
    }
    if (state.relative) {
      var ry = Y(100);
      svg.appendChild(sv("line", { class: "ref100", x1: m.l, x2: W - m.r, y1: ry, y2: ry }));
    }
    commits.forEach(function (c, i) {
      if (i > 0 && c.series != null && commits[i - 1].series != null && c.series !== commits[i - 1].series) {
        var bx = (X(i) + X(i - 1)) / 2;
        svg.appendChild(sv("line", { class: "brk", x1: bx, x2: bx, y1: m.t, y2: m.t + ph }));
        var lt = sv("text", { class: "brklabel", x: bx + 4, y: m.t + 10 });
        lt.textContent = seriesName(c.series).toLowerCase() + " starts"; svg.appendChild(lt);
      }
    });
    var step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / 62))));
    commits.forEach(function (c, i) {
      if (i % step && i !== n - 1) return;
      var tx = X(i), a = sv("text", { x: tx, y: H - 24, "text-anchor": "middle" });
      a.textContent = short(c.commit).slice(0, 7); svg.appendChild(a);
      var b = sv("text", { x: tx, y: H - 11, "text-anchor": "middle" });
      b.textContent = c.date.slice(5); svg.appendChild(b);
    });

    lines.forEach(function (ln) {
      var col = mcolor(ln.m);
      var on = ln.pts.filter(function (p) { return !p.off; });
      if (on.length > 1) {
        svg.appendChild(sv("polyline", { class: "ml" + (ln.g === 2 ? " dashed" : ""), style: "stroke:" + col,
          points: on.map(function (p) { return X(p.i) + "," + Y(p.shown); }).join(" ") }));
      }
    });
    lines.forEach(function (ln) {
      var col = mcolor(ln.m);
      ln.pts.forEach(function (p) {
        var x = X(p.i), y = Y(p.shown), mk;
        if (p.r.run === 1) mk = sv("circle", { class: "p1" + (p.off ? " off" : ""), cx: x, cy: y, r: 5.5, style: "fill:" + col });
        else mk = sv("rect", { class: "p2" + (p.off ? " off" : ""), x: x - 4.5, y: y - 4.5, width: 9, height: 9,
          transform: "rotate(45 " + x + " " + y + ")", style: "stroke:" + col });
        svg.appendChild(mk);
        var hit = sv("circle", { class: "hit", cx: x, cy: y, r: 11, tabindex: 0 });
        var html = "<b>" + esc(short(p.c.commit)) + "</b> - " + esc(p.r.date + " " + p.r.time) + "<br>" +
          (multi() ? mdot(p.m) + esc(mname(p.m)) + "<br>" : "") +
          esc(metric.label) + ": <b>" + fmt(p.v) + "</b>" +
          (state.relative ? " (" + fmt(p.shown) + "% of own baseline)" : "") +
          "<br>run " + p.r.run + ", " + esc(seriesName(p.r.series)) +
          (p.off ? "<br><i>off-target commit: not a benchmark target</i>" : "");
        hit.addEventListener("mousemove", function (ev) { showTip(html, ev); });
        hit.addEventListener("mouseleave", hideTip);
        hit.addEventListener("focus", function () {
          var b = hit.getBoundingClientRect(); showTip(html, { clientX: b.left, clientY: b.top });
        });
        hit.addEventListener("blur", hideTip);
        var ti = sv("title");
        ti.textContent = (multi() ? mname(p.m) + " " : "") + short(p.c.commit) + " run " + p.r.run + ": " + fmt(p.v) + metric.unit;
        hit.appendChild(ti);
        svg.appendChild(hit);
      });
    });
    box.appendChild(svg);
  }

  function legend() {
    var d = el("div", { class: "legend" });
    var h = "";
    if (multi()) selectedMachines().forEach(function (m) {
      h += "<span>" + mdot(m) + esc(mname(m)) + "</span>";
    });
    var showR2 = state.runMode !== "run1";
    h += '<span><svg width="16" height="14"><circle cx="8" cy="7" r="4.5" fill="var(--text)"/></svg> run 1' +
      (state.runMode === "warm" ? " (only when there is no run 2)" : "") + "</span>";
    if (showR2) h += '<span><svg width="16" height="14"><rect x="4" y="3" width="8" height="8" transform="rotate(45 8 7)" fill="var(--panel)" stroke="var(--text)" stroke-width="2"/></svg> run 2</span>';
    h += '<span><svg width="16" height="14"><line x1="8" x2="8" y1="0" y2="14" stroke="var(--brk)" stroke-dasharray="3 2"/></svg> series break</span>';
    if (state.relative) h += '<span><svg width="22" height="14"><line x1="0" x2="22" y1="7" y2="7" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="2 2"/></svg> 100% = own baseline</span>';
    h += '<span><svg width="16" height="14"><circle cx="8" cy="7" r="4.5" fill="var(--text)" opacity=".3"/></svg> faded = off-target commit (not a benchmark target; not connected)</span>';
    h += "<span>lower is better</span>";
    d.innerHTML = h;
    return d;
  }

  function summaryFor(scen, commits, mc) {
    var shown = commits.filter(function (c) { return rowsFor(mc, c.commit, scen).length; });
    var cur = shown[shown.length - 1], prev = shown[shown.length - 2];
    if (!cur) return null;
    var wrap = el("div", { class: "box" });
    wrap.appendChild(el("h3", {}, "Latest vs previous" + (multi() ? ": " + mname(mc) : "")));
    if (!prev) { wrap.appendChild(el("p", { class: "muted" }, "Only one benchmarked commit so far.")); return wrap; }
    var cr = rowsFor(mc, cur.commit, scen), pr = rowsFor(mc, prev.commit, scen);
    function vals(rs, k) {
      return rs.map(function (r) { return "<span title=\"run " + r.run + "\">" + fmt(r.metrics[k]) + "</span>"; }).join(" / ");
    }
    var label = state.runMode === "warm" ? "warm runs" : "run 1";
    var t = el("table");
    t.innerHTML = "<thead><tr><th>Metric</th><th>" + esc(short(prev.commit)) + " (previous)</th><th>" +
      esc(short(cur.commit)) + " (latest)</th><th>Change, " + label + "</th></tr></thead>";
    var tb = el("tbody");
    function sel(rs) { return state.runMode === "warm" ? pick(rs)[0] : rs.filter(function (r) { return r.run === 1; })[0]; }
    ALLM.forEach(function (mt) {
      var a = sel(pr), b = sel(cr);
      var ch = "n/a", cls = "";
      if (a && b && a.metrics[mt.key] != null && b.metrics[mt.key] != null) {
        var d = b.metrics[mt.key] - a.metrics[mt.key];
        var pct = a.metrics[mt.key] ? " (" + (d >= 0 ? "+" : "") + Math.round((d / a.metrics[mt.key]) * 100) + "%)" : "";
        ch = (d >= 0 ? "+" : "") + fmt(d) + pct;
        cls = d < 0 ? "good" : d > 0 ? "bad" : "";
      }
      var tr = el("tr");
      tr.innerHTML = "<td>" + esc(mt.label) + "</td><td>" + vals(pr, mt.key) + "</td><td>" + vals(cr, mt.key) +
        '</td><td class="' + cls + '">' + ch + "</td>";
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    var tw = el("div", { class: "tablewrap" }); tw.appendChild(t); wrap.appendChild(tw);
    var note = "Values are run 1 / run 2 where both exist. Change compares " + (state.runMode === "warm" ? "run 2 (run 1 where there is no run 2)" : "run 1 with run 1") + ".";
    if (prev.series !== cur.series) note += " The two commits are in different series (" + seriesName(prev.series) + " vs " + seriesName(cur.series) + "), so the procedure differs.";
    wrap.appendChild(el("p", { class: "muted" }, note));
    return wrap;
  }

  function renderScenarios() {
    var host = document.getElementById("scenarios");
    host.innerHTML = "";
    var commits = commitsShown();
    if (!commits.length) { host.appendChild(el("p", { class: "box muted" }, "No machine selected.")); return; }
    Object.keys(D.scenarios).forEach(function (sid) {
      var sc = D.scenarios[sid];
      var sec = el("section", { class: "scen" });
      sec.appendChild(el("h2", {}, sc.title));
      sec.appendChild(el("p", { class: "muted" }, sc.subtitle));
      sec.appendChild(legend());
      var grid = el("div", { class: "charts" });
      sec.appendChild(grid);
      host.appendChild(sec);
      METRICS.forEach(function (mt) { chart(grid, mt, sid, commits); });
      selectedMachines().forEach(function (mc) {
        var s = summaryFor(sid, commits, mc);
        if (s) sec.appendChild(s);
      });
    });
  }

  // Latest benchmark target that at least two selected machines ran. Off-target commits are not compared.
  function renderSameCommit() {
    var host = document.getElementById("samecommit");
    host.innerHTML = ""; host.hidden = true;
    var sel = selectedMachines();
    if (sel.length < 2) return;
    var found = null;
    for (var i = D.targets.length - 1; i >= 0 && !found; i--) {
      var t = D.targets[i];
      var ms = sel.filter(function (m) { return t.machines.indexOf(m.id) >= 0; });
      if (ms.length > 1) found = { t: t, ms: ms };
    }
    if (!found) return;
    host.hidden = false;
    host.appendChild(el("h2", {}, "Same commit, different machines"));
    var p = el("p", { class: "muted" });
    p.innerHTML = "Latest benchmark target run by more than one machine: " +
      '<a class="sha" href="' + REPO + "/commit/" + esc(found.t.commit_full) + '">' + esc(found.t.commit) + "</a> (" + esc(found.t.label) + "), " + esc(found.t.date) +
      ". A commit that is code-identical to the target counts for it. Different GPU, CPU, resolution or platform change every number, so read this as a hardware comparison, not a code comparison.";
    host.appendChild(p);
    Object.keys(D.scenarios).forEach(function (sid) {
      var any = found.ms.some(function (m) { return targetRows(m, found.t, sid).length; });
      if (!any) return;
      var html = "<h3>" + esc(D.scenarios[sid].title) + "</h3>" +
        '<div class="tablewrap"><table><thead><tr><th>Machine</th><th>Platform</th><th>GPU</th><th>Resolution</th><th>Commit</th><th>Runs shown</th>';
      ALLM.forEach(function (mt) { html += "<th>" + esc(mt.label) + "</th>"; });
      html += "</tr></thead><tbody>";
      found.ms.forEach(function (m) {
        var all = targetRows(m, found.t, sid), rs = pick(all);
        if (!rs.length) return;
        html += "<tr><td>" + mdot(m) + esc(mname(m)) + " " + handleLink(m) + "</td><td>" + platChip(m) + "</td><td>" + esc(m.gpu) + "</td><td>" + esc(m.resolution) +
          "</td><td><span class=\"sha\">" + esc(all[0].commit) + "</span></td><td>" + rs.map(function (r) { return "run " + r.run; }).join(", ") + "</td>";
        ALLM.forEach(function (mt) {
          html += "<td>" + rs.map(function (r) { return fmt(r.metrics[mt.key]); }).join(" / ") + "</td>";
        });
        html += "</tr>";
      });
      html += "</tbody></table></div>";
      var box = el("div", { class: "box" }); box.innerHTML = html; host.appendChild(box);
    });
  }

  // Machines x targets: which machine ran which benchmark target.
  function renderCoverage() {
    var host = document.getElementById("coverage");
    var cur = currentTarget();
    var html = '<div class="tablewrap"><table class="cov"><thead><tr><th>Machine</th>';
    D.targets.forEach(function (t) {
      html += '<th class="' + (t.kind === "release" ? "rel" : "") + '" title="' + esc(t.label + " (" + t.kind + ", " + t.date + ")") + '">' +
        '<a class="sha" href="' + REPO + "/commit/" + esc(t.commit_full) + '">' + esc(t.commit) + "</a><br>" + esc(t.label) +
        (t === cur ? "<br><b>current</b>" : "") + "</th>";
    });
    html += "</tr></thead><tbody>";
    D.machines.forEach(function (m) {
      html += "<tr><td>" + mdot(m) + esc(mname(m)) + " " + platChip(m) + "</td>";
      D.targets.forEach(function (t) {
        var has = t.machines.indexOf(m.id) >= 0;
        var variant = has && !D.rows.some(function (r) { return r.machine === m.id && r.commit_full === t.commit_full; });
        html += '<td class="' + (has ? "yes" : "no") + '" title="' + (has ? (variant ? "code-identical commit counts for this target" : "benchmarked") : "not benchmarked") + '">' +
          (has ? (variant ? "&#10003;*" : "&#10003;") : "&middot;") + "</td>";
      });
      html += "</tr>";
    });
    html += "</tbody></table></div>";
    var off = D.commits.filter(function (c) { return c.off_target; });
    host.innerHTML = html + '<p class="muted small">Bold headers are release targets: anchor points every machine should run at least once. * = a different commit that is code-identical to the target (only docs, site, tests, .github, tools or *.md differ).' +
      (off.length ? " Off-target commits (" + off.map(function (c) { return esc(c.commit); }).join(", ") + ") are shown faded in the charts and left out of comparisons between machines." : "") + "</p>";
  }

  function renderStandard() {
    var cur = currentTarget();
    document.getElementById("standard").innerHTML =
      "<b>Current standard:</b> <a class=\"sha\" href=\"" + REPO + "/commit/" + esc(cur.commit_full) + "\">" + esc(cur.commit) + "</a> (" + esc(cur.label) + ", " + esc(cur.date) + "). " +
      "Everyone benchmarks the same commits so results can be compared. To add your machine: <code>cd kit &amp;&amp; python3 build.py &amp;&amp; python3 bench.py --machine &lt;id&gt;</code> (Linux, Windows, macOS) " +
      "(builds the current standard by default; see CONTRIBUTING.md).";
  }

  function metricsTable(commit) {
    var out = "", sel = selectedMachines();
    Object.keys(D.scenarios).forEach(function (sid) {
      var block = "";
      sel.forEach(function (m) {
        rowsFor(m, commit, sid).forEach(function (r) {
          block += "<tr><td>" + (multi() ? mdot(m) + esc(mname(m)) + ", " : "") + "run " + r.run +
            (r.series === 2 ? (r.run === 1 ? " (cold?)" : " (warm)") : "") +
            (r.note ? ' <span class="muted">(' + esc(r.note) + ")</span>" : "") + "</td><td>" +
            fmt(r.metrics.over33_pct) + "%</td><td>" + fmt(r.metrics.p50_ms) + "</td><td>" + fmt(r.metrics.p99_ms) +
            "</td><td>" + fmt(r.metrics.slow_world_p99_ms) + "</td><td>" + esc(r.date + " " + r.time) + "</td></tr>";
        });
      });
      if (block) out += "<tr><th colspan=\"6\" style=\"text-align:left\">" + esc(D.scenarios[sid].title) + "</th></tr>" + block;
    });
    return '<div class="tablewrap"><table><thead><tr><th>Run</th><th>&gt;33 ms</th><th>p50 ms</th><th>p99 ms</th><th>slow-world p99 ms</th><th>when</th></tr></thead><tbody>' +
      out + "</tbody></table></div>";
  }

  function renderTimeline() {
    var host = document.getElementById("timeline");
    host.innerHTML = "";
    commitsShown().slice().reverse().forEach(function (c) {
      var box = el("article", { class: "tl" });
      var link = c.commit_full ? REPO + "/commit/" + c.commit_full : null;
      var who = selectedMachines().filter(function (m) { return D.rows.some(function (r) { return r.commit === c.commit && r.machine === m.id; }); });
      var head = '<div class="tl-head"><h3>' + (link ? '<a class="sha" href="' + link + '">' + esc(c.commit) + "</a>" : '<span class="sha">' + esc(c.commit) + "</span>") +
        '</h3><span class="when">' + esc(c.date) + (c.series != null ? " - " + esc(seriesName(c.series)) : "") + "</span>" +
        (multi() ? '<span class="who">' + who.map(function (m) { return mdot(m) + esc(mname(m)); }).join(" ") + "</span>" : "") + "</div>";
      var tg = D.targets.filter(function (t) { return t.commit === c.target; })[0];
      var tinfo = c.off_target ? '<span class="chip off">off-target: not a benchmark target</span>'
        : tg ? '<span class="chip">' + (c.target_exact ? "benchmark target" : "counts for target " + esc(tg.commit)) + " (" + esc(tg.label) + ")</span>" : "";
      var html = head + (tinfo ? "<div>" + tinfo + "</div>" : "") + metricsTable(c.commit);
      var ch = c.changes;
      if (c.first_benchmark) {
        html += '<p class="muted">First benchmarked commit: no change list.</p>';
      } else if (!ch) {
        html += '<p class="muted">Change list unavailable for this commit.</p>';
      } else {
        html += "<p><b>" + ch.commit_count + " commits</b> since <span class=\"sha\">" + esc(ch.since) + "</span>";
        if (ch.merged_prs.length) html += ", " + ch.merged_prs.length + " merged pull request" + (ch.merged_prs.length > 1 ? "s" : "");
        html += "</p><div>";
        D.buckets.forEach(function (b) {
          var n = ch.bucket_counts[b];
          if (n) html += '<span class="chip">' + esc(b) + " <b>" + n + "</b></span>";
        });
        html += "</div>";
        if (ch.merged_prs.length) {
          html += "<details><summary>Merged pull requests (" + ch.merged_prs.length + ")</summary><ul>";
          ch.merged_prs.forEach(function (p) {
            html += '<li><a href="' + REPO + "/pull/" + p.number + '">#' + p.number + "</a> " +
              (p.title ? esc(p.title) : "") + (p.author ? ' <span class="muted">by ' + esc(p.author) + "</span>" : "") + "</li>";
          });
          html += "</ul></details>";
        }
        D.buckets.forEach(function (b) {
          var list = ch.commits.filter(function (x) { return x.bucket === b; });
          if (!list.length) return;
          html += "<details><summary>" + esc(b) + " (" + list.length + ")</summary><ul>";
          list.forEach(function (x) {
            html += '<li><a class="sha" href="' + REPO + "/commit/" + x.hash + '">' + esc(x.short) + "</a> " + linkify(x.subject) + "</li>";
          });
          html += "</ul></details>";
        });
      }
      box.innerHTML = html;
      host.appendChild(box);
    });
  }

  function renderSeries() {
    var ul = document.getElementById("series-list"); ul.innerHTML = "";
    D.series.forEach(function (s) {
      var li = el("li");
      li.innerHTML = "<b>" + esc(s.label) + "</b> from " + esc(s.start) + " (maintainer machine): " + esc(s.description);
      ul.appendChild(li);
    });
  }

  function renderMachines() {
    var host = document.getElementById("machines");
    host.innerHTML = "";
    D.machines.forEach(function (m) {
      var card = el("label", { class: "mcard" });
      var cb = el("input", { type: "checkbox" });
      cb.checked = !!state.selected[m.id];
      if (!multi()) cb.hidden = true;
      cb.addEventListener("change", function () {
        state.selected[m.id] = cb.checked;
        if (!selectedMachines().length) { state.selected[m.id] = true; cb.checked = true; }
        renderResults();
      });
      card.appendChild(cb);
      var body = el("div", { class: "mbody" });
      body.innerHTML =
        '<div class="mtitle">' + mdot(m) + "<b>" + esc(mname(m)) + "</b> " + handleLink(m) + " " + platChip(m) + (m.maintainer ? ' <span class="chip">maintainer</span>' : "") + "</div>" +
        '<div class="muted">' + esc(m.cpu) + "; " + esc(m.gpu) + "; " + esc(String(m.ram_gb)) + " GB RAM; " + esc(m.os) + "</div>" +
        "<div>Renders at <b>" + esc(m.resolution) + "</b> - " + m.commit_count + " benchmarked commit" + (m.commit_count === 1 ? "" : "s") +
        ", last " + esc(m.last_date) + "</div>" +
        (m.notes ? '<div class="muted">' + esc(m.notes) + "</div>" : "");
      card.appendChild(body);
      host.appendChild(card);
    });
  }

  function renderControls() {
    var host = document.getElementById("controls");
    host.innerHTML = "";
    var runs = el("fieldset", { class: "ctl" });
    runs.innerHTML = "<legend>Runs shown</legend>";
    [["warm", "Warm runs (run 2 where present, else run 1)"], ["run1", "Run 1 only"], ["both", "Both runs"]].forEach(function (o) {
      var l = el("label"), r = el("input", { type: "radio", name: "runmode", value: o[0] });
      r.checked = state.runMode === o[0];
      r.addEventListener("change", function () { state.runMode = o[0]; renderResults(); });
      l.appendChild(r); l.appendChild(document.createTextNode(" " + o[1])); runs.appendChild(l);
    });
    runs.appendChild(el("p", { class: "muted small" }, "Each benchmark is run twice back-to-back. Run 1 may be cache-cold (disk cache, shader cache) and often looks worse; run 2 is the warm one. Runs are never averaged. Older single-run data counts as run 1."));
    host.appendChild(runs);

    if (multi()) {
      var rel = el("fieldset", { class: "ctl" });
      rel.innerHTML = "<legend>Compare machines</legend>";
      var l = el("label"), cb = el("input", { type: "checkbox" });
      cb.checked = state.relative;
      cb.addEventListener("change", function () { state.relative = cb.checked; renderControls(); renderResults(); });
      l.appendChild(cb); l.appendChild(document.createTextNode(" Relative to each machine's own baseline (% of own value)"));
      rel.appendChild(l);
      var l2 = el("label", { class: "reflab" });
      l2.appendChild(document.createTextNode("Baseline commit "));
      var sel = el("select"); sel.disabled = !state.relative;
      sel.appendChild(el("option", { value: "" }, "each machine's first target"));
      D.targets.forEach(function (t) { sel.appendChild(el("option", { value: t.commit }, short(t.commit) + " " + t.label)); });
      sel.value = state.ref;
      sel.addEventListener("change", function () { state.ref = sel.value; renderResults(); });
      l2.appendChild(sel); rel.appendChild(l2);
      rel.appendChild(el("p", { class: "muted small" }, "100% is the machine's own value at the baseline commit, so the shape of a trend can be compared across different hardware. Only benchmark targets can be a baseline; a machine that did not run the chosen one gets no line."));
      host.appendChild(rel);
    }
  }

  function renderCaveat() {
    var host = document.getElementById("caveat");
    var sel = selectedMachines();
    host.hidden = true;
    if (sel.length < 2 || state.relative) return;
    var res = {}, gpu = {}, plat = {};
    sel.forEach(function (m) { res[m.resolution] = 1; gpu[m.gpu] = 1; plat[m.platform] = 1; });
    var diff = [];
    if (Object.keys(gpu).length > 1) diff.push("GPUs");
    if (Object.keys(res).length > 1) diff.push("resolutions");
    if (Object.keys(plat).length > 1) diff.push("platforms (" + Object.keys(plat).map(function (p) { return PLAT[p] || p; }).join(", ") + ": different operating system, graphics driver stack and build)");
    host.textContent = "Caution: absolute values of machines with different " + (diff.length ? diff.join(" and ") : "CPUs or drivers") +
      " are not comparable. A faster GPU at a lower resolution is not a code improvement. Use \"relative to own baseline\" to compare trends, or compare machines of the same hardware and resolution.";
    host.hidden = false;
  }

  // ---- Compare two commits ----
  var cmp = { a: "", b: "", m: "" };
  function median(xs) {
    var v = xs.slice().sort(function (x, y) { return x - y; }), n = v.length;
    return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  }
  function cmpCommits(mid) {
    return D.commits.filter(function (c) {
      return D.rows.some(function (r) { return r.commit === c.commit && r.machine === mid; });
    }).sort(function (x, y) { return (y.date + y.time).localeCompare(x.date + x.time); });
  }
  function cmpTime(c) { return Date.parse(c.date + "T" + (c.time || "00:00:00") + "Z"); }
  // B for a given A: the newest commit benchmarked 12-24 h before A; else the newest older than 24 h; else the previous commit.
  function cmpOneDay(list, a) {
    var H = 3600000, idx = list.indexOf(a), older = list.slice(idx + 1), t = cmpTime(a), i;
    for (i = 0; i < older.length; i++) { var age = t - cmpTime(older[i]); if (age >= 12 * H && age <= 24 * H) return older[i]; }
    for (i = 0; i < older.length; i++) { if (t - cmpTime(older[i]) > 24 * H) return older[i]; }
    return older[0] || a;
  }
  function cmpDefaults(list) {
    if (!list.length) return;
    cmp.a = list[0].commit; cmp.b = cmpOneDay(list, list[0]).commit;
  }
  function cmpAgo(list, days) {
    var a = list.filter(function (c) { return c.commit === cmp.a; })[0];
    if (!a) return null;
    var older = list.slice(list.indexOf(a) + 1);
    for (var i = 0; i < older.length; i++) if (cmpTime(a) - cmpTime(older[i]) >= days * 86400000) return older[i];
    return older[older.length - 1] || null;
  }
  function cmpRows(mid, commit, scen) {
    return D.rows.filter(function (r) { return r.machine === mid && r.commit === commit && r.scenario === scen; });
  }
  function cmpUrl() {
    var q = [];
    if (cmp.a) q.push("a=" + encodeURIComponent(cmp.a));
    if (cmp.b) q.push("b=" + encodeURIComponent(cmp.b));
    if (multi() && cmp.m) q.push("m=" + encodeURIComponent(cmp.m));
    try { history.replaceState(null, "", q.length ? "?" + q.join("&") + "#compare-sec" : location.pathname); } catch (e) {}
  }
  function cmpReadUrl() {
    var p = new URLSearchParams(location.search);
    var m = p.get("m");
    cmp.m = m && machineById(m) ? m : (D.machines.filter(function (x) { return x.maintainer; })[0] || D.machines[0]).id;
    var list = cmpCommits(cmp.m);
    cmpDefaults(list);
    function find(h) {
      if (!h) return null;
      return list.filter(function (c) { return c.commit.indexOf(h) === 0 || c.commit_full.indexOf(h) === 0; })[0];
    }
    var a = find(p.get("a")), b = find(p.get("b"));
    if (a) cmp.a = a.commit;
    if (b) cmp.b = b.commit;
  }
  function renderCompare() {
    var sec = document.getElementById("compare-sec"), host = document.getElementById("compare");
    var list = cmpCommits(cmp.m);
    if (list.length < 2) { sec.hidden = true; return; }
    sec.hidden = false;
    host.innerHTML = "";
    var bar = el("div", { class: "cmp-bar" });
    function picker(label, key) {
      var l = el("label", { class: "cmp-pick" }, label + " ");
      var s = el("select");
      list.forEach(function (c) { s.appendChild(el("option", { value: c.commit }, short(c.commit) + "  " + c.date + " " + (c.time || "").slice(0, 5))); });
      s.value = cmp[key];
      s.addEventListener("change", function () { cmp[key] = s.value; cmpUrl(); renderCompare(); });
      l.appendChild(s); return l;
    }
    if (multi()) {
      var ml = el("label", { class: "cmp-pick" }, "Machine ");
      var ms = el("select");
      D.machines.forEach(function (m) { ms.appendChild(el("option", { value: m.id }, mname(m) + " (" + platLabel(m) + ")")); });
      ms.value = cmp.m;
      ms.addEventListener("change", function () { cmp.m = ms.value; cmpDefaults(cmpCommits(cmp.m)); cmpUrl(); renderCompare(); });
      ml.appendChild(ms); bar.appendChild(ml);
    }
    bar.appendChild(picker("A (new)", "a"));
    bar.appendChild(picker("B (baseline)", "b"));
    var quick = el("span", { class: "cmp-quick" });
    [["vs previous benchmark", 0], ["vs ~1 day", 1], ["vs ~1 week", 7]].forEach(function (q) {
      var btn = el("button", { type: "button" }, q[0]);
      btn.addEventListener("click", function () {
        var c = q[1] === 1 ? cmpOneDay(list, list.filter(function (x) { return x.commit === cmp.a; })[0]) : q[1] ? cmpAgo(list, q[1]) : list[Math.max(0, list.map(function (x) { return x.commit; }).indexOf(cmp.a)) + 1];
        if (c) { cmp.b = c.commit; cmpUrl(); renderCompare(); }
      });
      quick.appendChild(btn);
    });
    bar.appendChild(quick);
    host.appendChild(bar);

    var ca = list.filter(function (c) { return c.commit === cmp.a; })[0], cb = list.filter(function (c) { return c.commit === cmp.b; })[0];
    if (!ca || !cb) return;
    var info = el("p", { class: "muted small" });
    info.innerHTML = 'A: <a href="' + REPO + "/commit/" + esc(ca.commit_full) + '"><code>' + esc(short(ca.commit)) + "</code></a> " + esc(ca.date) +
      ' &nbsp; B: <a href="' + REPO + "/commit/" + esc(cb.commit_full) + '"><code>' + esc(short(cb.commit)) + "</code></a> " + esc(cb.date) +
      ' &nbsp; <a href="' + REPO + "/compare/" + esc(cb.commit_full) + "..." + esc(ca.commit_full) + '">upstream changes between them</a>';
    host.appendChild(info);
    if (ca.commit === cb.commit) host.appendChild(el("p", { class: "muted" }, "A and B are the same commit."));

    var sa = {}, sb = {};
    D.rows.forEach(function (r) {
      if (r.machine !== cmp.m) return;
      if (r.commit === ca.commit) sa[r.series] = 1;
      if (r.commit === cb.commit) sb[r.series] = 1;
    });
    var ka = Object.keys(sa), kb = Object.keys(sb);
    if (ka.length !== 1 || kb.length !== 1 || ka[0] !== kb[0]) {
      host.appendChild(el("p", { class: "caveat" }, "Warning: A is from " + ka.map(seriesName).join(", ") + " and B from " + kb.map(seriesName).join(", ") +
        ". The benchmark procedure differs between series (see \"Runs and series\"), so a difference may come from the procedure rather than from the code."));
    }

    var multiRun = false;
    Object.keys(D.scenarios).forEach(function (sid) {
      var ra = cmpRows(cmp.m, ca.commit, sid), rb = cmpRows(cmp.m, cb.commit, sid);
      var sc = D.scenarios[sid];
      var h = el("h3", { class: "cmp-h" }, sc.title);
      host.appendChild(h);
      if (!ra.length || !rb.length) {
        host.appendChild(el("p", { class: "muted" }, "Not measured for " + (!ra.length && !rb.length ? "either commit" : !ra.length ? "A" : "B") + "."));
        return;
      }
      if (ra.length > 1 || rb.length > 1) multiRun = true;
      var wrap = el("div", { class: "tablewrap" }), t = el("table", { class: "cmp" });
      t.innerHTML = "<thead><tr><th>Metric</th><th>A " + esc(short(ca.commit)) + " (" + ra.length + (ra.length > 1 ? " runs" : " run") + ")</th><th>B " +
        esc(short(cb.commit)) + " (" + rb.length + (rb.length > 1 ? " runs" : " run") + ")</th><th>Change</th><th>%</th></tr></thead>";
      var tb = el("tbody");
      ALLM.forEach(function (mt) {
        var va = ra.map(function (r) { return r.metrics[mt.key]; }).filter(function (v) { return v != null; });
        var vb = rb.map(function (r) { return r.metrics[mt.key]; }).filter(function (v) { return v != null; });
        var tr = el("tr");
        tr.appendChild(el("td", {}, mt.label));
        if (!va.length || !vb.length) {
          tr.appendChild(el("td", {}, va.length ? fmt(median(va)) : "n/a"));
          tr.appendChild(el("td", {}, vb.length ? fmt(median(vb)) : "n/a"));
          tr.appendChild(el("td", {}, "")); tr.appendChild(el("td", {}, ""));
        } else {
          var x = median(va), y = median(vb), d = x - y;
          var pct = y !== 0 ? d / y * 100 : null;
          var rd = Math.round(d * 10) / 10;
          var cls = Math.abs(pct == null ? d : pct) < 2 || rd === 0 ? "" : d < 0 ? "good" : "bad";
          tr.appendChild(el("td", {}, fmt(x)));
          tr.appendChild(el("td", {}, fmt(y)));
          tr.appendChild(el("td", { class: cls }, (d > 0 ? "+" : "") + fmt(d)));
          tr.appendChild(el("td", { class: cls }, pct == null ? "n/a" : (pct > 0 ? "+" : "") + (Math.round(pct * 10) / 10) + "%"));
        }
        tb.appendChild(tr);
      });
      t.appendChild(tb); wrap.appendChild(t); host.appendChild(wrap);
    });
    host.appendChild(el("p", { class: "muted small" },
      "Green = better (lower), red = worse; changes under 2% are not colored. When a commit has several runs of a scenario, the median is used (the mean for two runs)" +
      (multiRun ? ", so run 1 (possibly cache-cold) and run 2 are both included." : ".") + " Runs on one machine only; single runs are noisy, so treat small differences with caution."));
  }

  function renderResults() {
    renderMachines(); renderCaveat(); renderCoverage(); renderSameCommit(); renderScenarios(); renderTimeline();
  }

  function init(d) {
    D = d;
    D.machines.forEach(function (m) { state.selected[m.id] = true; });
    renderStandard(); renderSeries(); renderControls(); renderResults();
    cmpReadUrl(); renderCompare();
    document.getElementById("controls-sec").hidden = false;
    var t; window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(renderScenarios, 150); });
  }

  fetch("data/bench.json").then(function (r) { return r.json(); }).then(init).catch(function (e) {
    document.getElementById("scenarios").appendChild(el("p", { class: "box" },
      "Could not load data/bench.json (" + e + "). Serve the folder over http, e.g. python3 -m http.server."));
  });
})();
