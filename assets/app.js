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
  var D = null, machine = null;
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

  function rowsFor(commit, scen) {
    return D.rows.filter(function (r) {
      return r.commit === commit && r.scenario === scen && r.machine === machine;
    }).sort(function (a, b) { return a.run - b.run; });
  }
  function commitsShown() {
    return D.commits.filter(function (c) {
      return D.rows.some(function (r) { return r.commit === c.commit && r.machine === machine; });
    });
  }
  function seriesName(id) {
    var s = D.series.filter(function (x) { return x.id === id; })[0];
    return s ? s.label : "Series " + id;
  }

  function showTip(html, ev) {
    tip.innerHTML = html; tip.hidden = false;
    var w = tip.offsetWidth, x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
    if (y + tip.offsetHeight > window.innerHeight - 8) y = ev.clientY - tip.offsetHeight - 14;
    tip.style.left = Math.max(4, x) + "px"; tip.style.top = Math.max(4, y) + "px";
  }
  function hideTip() { tip.hidden = true; }

  function niceMax(v) {
    if (v <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    var m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return m * p;
  }

  function niceTicks(v) {
    if (v <= 0) v = 1;
    var raw = v / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
    var st = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p, out = [];
    for (var x = 0; x < v + st * 0.999; x += st) out.push(Math.round(x / st * 1e6) / 1e6 * st);
    return out;
  }

  function chart(host, metric, scen, commits) {
    var box = el("div", { class: "chart" });
    box.appendChild(el("h3", {}, metric.label));
    host.appendChild(box);
    var W = Math.max(240, Math.floor(box.clientWidth - 20)), H = 250;
    var m = { l: 46, r: 26, t: 14, b: 48 };
    var pw = W - m.l - m.r, ph = H - m.t - m.b;
    var svg = sv("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img",
      "aria-label": metric.label + " per benchmarked commit" });
    var max = 0;
    commits.forEach(function (c) {
      rowsFor(c.commit, scen).forEach(function (r) { var v = r.metrics[metric.key]; if (v != null && v > max) max = v; });
    });
    var tk = niceTicks(max);
    max = tk[tk.length - 1];
    var n = commits.length;
    function X(i) { return m.l + (n === 1 ? pw / 2 : (pw * i) / (n - 1)); }
    function Y(v) { return m.t + ph - (v / max) * ph; }
    for (var g = 0; g < tk.length; g++) {
      var gv = tk[g], gy = Y(gv);
      svg.appendChild(sv("line", { class: "grid", x1: m.l, x2: W - m.r, y1: gy, y2: gy }));
      var t = sv("text", { x: m.l - 5, y: gy + 4, "text-anchor": "end" }); t.textContent = fmt(gv); svg.appendChild(t);
    }
    // series breaks
    commits.forEach(function (c, i) {
      if (i > 0 && c.series !== commits[i - 1].series) {
        var bx = (X(i) + X(i - 1)) / 2;
        svg.appendChild(sv("line", { class: "brk", x1: bx, x2: bx, y1: m.t, y2: m.t + ph }));
        var lt = sv("text", { class: "brklabel", x: bx + 4, y: m.t + 10 });
        lt.textContent = seriesName(c.series).toLowerCase() + " starts"; svg.appendChild(lt);
      }
    });
    // x labels (thin out on narrow charts)
    var step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / 62))));
    commits.forEach(function (c, i) {
      if (i % step && i !== n - 1) return;
      var tx = X(i), a = sv("text", { x: tx, y: H - 24, "text-anchor": "middle" });
      a.textContent = short(c.commit).slice(0, 7); svg.appendChild(a);
      var b = sv("text", { x: tx, y: H - 11, "text-anchor": "middle" });
      b.textContent = c.date.slice(5); svg.appendChild(b);
    });
    // lines + markers per run number
    [1, 2].forEach(function (run) {
      var pts = [];
      commits.forEach(function (c, i) {
        var r = rowsFor(c.commit, scen).filter(function (x) { return x.run === run; })[0];
        if (r && r.metrics[metric.key] != null) pts.push({ i: i, r: r, c: c, v: r.metrics[metric.key] });
      });
      if (pts.length > 1) {
        svg.appendChild(sv("polyline", { class: run === 1 ? "l1" : "l2",
          points: pts.map(function (p) { return X(p.i) + "," + Y(p.v); }).join(" ") }));
      }
      pts.forEach(function (p) {
        var x = X(p.i), y = Y(p.v), mk;
        if (run === 1) mk = sv("circle", { class: "p1", cx: x, cy: y, r: 5.5 });
        else mk = sv("rect", { class: "p2", x: x - 4.5, y: y - 4.5, width: 9, height: 9, transform: "rotate(45 " + x + " " + y + ")" });
        svg.appendChild(mk);
        var hit = sv("circle", { class: "hit", cx: x, cy: y, r: 11, tabindex: 0 });
        var html = "<b>" + esc(short(p.c.commit)) + "</b> - " + esc(p.r.date + " " + p.r.time) + "<br>" +
          esc(metric.label) + ": <b>" + fmt(p.v) + "</b><br>run " + run + ", " + esc(seriesName(p.r.series));
        hit.addEventListener("mousemove", function (ev) { showTip(html, ev); });
        hit.addEventListener("mouseleave", hideTip);
        hit.addEventListener("focus", function () {
          var b = hit.getBoundingClientRect(); showTip(html, { clientX: b.left, clientY: b.top });
        });
        hit.addEventListener("blur", hideTip);
        var ti = sv("title"); ti.textContent = short(p.c.commit) + " run " + run + ": " + fmt(p.v) + metric.unit;
        hit.appendChild(ti);
        svg.appendChild(hit);
      });
    });
    box.appendChild(svg);
  }

  function legend() {
    var d = el("div", { class: "legend" });
    d.innerHTML =
      '<span><svg width="16" height="14"><circle cx="8" cy="7" r="4.5" fill="var(--run1)"/></svg> run 1</span>' +
      '<span><svg width="16" height="14"><rect x="4" y="3" width="8" height="8" transform="rotate(45 8 7)" fill="var(--panel)" stroke="var(--run2)" stroke-width="2"/></svg> run 2</span>' +
      '<span><svg width="16" height="14"><line x1="8" x2="8" y1="0" y2="14" stroke="var(--brk)" stroke-dasharray="3 2"/></svg> series break</span>' +
      "<span>lower is better</span>";
    return d;
  }

  function summary(scen, commits) {
    var cur = commits[commits.length - 1], prev = commits[commits.length - 2];
    if (!cur) return null;
    var wrap = el("div", { class: "box" });
    wrap.appendChild(el("h3", {}, "Latest vs previous"));
    var cr = rowsFor(cur.commit, scen);
    if (!prev) { wrap.appendChild(el("p", { class: "muted" }, "Only one benchmarked commit so far.")); return wrap; }
    var pr = rowsFor(prev.commit, scen);
    function cell(rs) {
      return rs.length ? rs.map(function (r) { return r.run; }) : [];
    }
    function vals(rs, k) {
      return rs.map(function (r) { return "<span title=\"run " + r.run + "\">" + fmt(r.metrics[k]) + "</span>"; }).join(" / ");
    }
    var t = el("table");
    t.innerHTML = "<thead><tr><th>Metric</th><th>" + esc(short(prev.commit)) + " (previous)</th><th>" +
      esc(short(cur.commit)) + " (latest)</th><th>Change, run 1</th></tr></thead>";
    var tb = el("tbody");
    ALLM.forEach(function (mt) {
      var a = pr.filter(function (r) { return r.run === 1; })[0], b = cr.filter(function (r) { return r.run === 1; })[0];
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
    var note = "Values are run 1 / run 2 where both exist. Change compares run 1 with run 1.";
    if (prev.series !== cur.series) note += " The two commits are in different series (" + seriesName(prev.series) + " vs " + seriesName(cur.series) + "), so the procedure differs.";
    wrap.appendChild(el("p", { class: "muted" }, note));
    return wrap;
  }

  function renderScenarios() {
    var host = document.getElementById("scenarios");
    host.innerHTML = "";
    var commits = commitsShown();
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
      var s = summary(sid, commits.filter(function (c) { return rowsFor(c.commit, sid).length; }));
      if (s) sec.appendChild(s);
    });
  }

  function metricsTable(commit) {
    var out = "";
    Object.keys(D.scenarios).forEach(function (sid) {
      var rs = rowsFor(commit, sid);
      if (!rs.length) return;
      out += "<tr><th colspan=\"6\" style=\"text-align:left\">" + esc(D.scenarios[sid].title) + "</th></tr>";
      rs.forEach(function (r) {
        out += "<tr><td>run " + r.run + (r.series === 2 ? (r.run === 1 ? " (cold?)" : " (warm)") : "") + (r.note ? ' <span class="muted">(' + esc(r.note) + ")</span>" : "") + "</td><td>" +
          fmt(r.metrics.over33_pct) + "%</td><td>" + fmt(r.metrics.p50_ms) + "</td><td>" + fmt(r.metrics.p99_ms) +
          "</td><td>" + fmt(r.metrics.slow_world_p99_ms) + "</td><td>" + esc(r.date + " " + r.time) + "</td></tr>";
      });
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
      var head = '<div class="tl-head"><h3>' + (link ? '<a class="sha" href="' + link + '">' + esc(c.commit) + "</a>" : '<span class="sha">' + esc(c.commit) + "</span>") +
        '</h3><span class="when">' + esc(c.date) + " - " + esc(seriesName(c.series)) + "</span></div>";
      var html = head + metricsTable(c.commit);
      var ch = c.changes;
      if (c.first_benchmark) {
        html += '<p class="muted">First benchmark: no change list.</p>';
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

  function renderSetup() {
    document.getElementById("machine-desc").textContent = D.machines[machine] || machine;
    var rs = D.rows.filter(function (r) { return r.machine === machine; });
    var seen = {};
    rs.forEach(function (r) { seen[r.gpu + ", driver " + r.driver] = 1; });
    document.getElementById("gpu-driver").textContent = Object.keys(seen).join("; ") || "-";
    var ul = document.getElementById("series-list"); ul.innerHTML = "";
    D.series.forEach(function (s) {
      var li = el("li");
      li.innerHTML = "<b>" + esc(s.label) + "</b> from " + esc(s.start) + ": " + esc(s.description);
      ul.appendChild(li);
    });
  }

  function renderAll() { renderSetup(); renderScenarios(); renderTimeline(); }

  function init(d) {
    D = d;
    var ms = Object.keys(D.machines);
    D.rows.forEach(function (r) { if (ms.indexOf(r.machine) < 0) ms.push(r.machine); });
    machine = ms[0];
    if (ms.length > 1) {
      var sel = document.getElementById("machine-select");
      ms.forEach(function (m) { var o = el("option", { value: m }, D.machines[m] || m); sel.appendChild(o); });
      sel.addEventListener("change", function () { machine = sel.value; renderAll(); });
      document.getElementById("machine-bar").hidden = false;
    }
    renderAll();
    var t; window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(renderScenarios, 150); });
  }

  fetch("data/bench.json").then(function (r) { return r.json(); }).then(init).catch(function (e) {
    document.getElementById("scenarios").appendChild(el("p", { class: "box" },
      "Could not load data/bench.json (" + e + "). Serve the folder over http, e.g. python3 -m http.server."));
  });
})();
