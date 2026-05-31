/* TCRMP Coral expert-review viewer — static, no backend.
   Reads review_manifest.json + codes.json (same dir), renders one card per
   flagged mask, persists answers in localStorage, exports a UID->code CSV. */
(function () {
  "use strict";

  var LS_ANS = "tcrmp_review_answers_v1";   // {uid:{code,conf,skipped,answered}}
  var FILL = "#22d3ee";                      // mask highlight (matches the baked outline)
  var DEFAULT_OPACITY = 0.45;

  var CODES = null, MANIFEST = null, BYCODE = {};
  var answers = load(LS_ANS) || {};

  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  function getJSON(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(url + " -> " + r.status); return r.json();
    });
  }

  function defaultAnswer() {
    return { code: CODES.idk.code, conf: CODES.default_confidence || "high",
             skipped: false, answered: false };
  }
  function ansFor(uid) {
    if (!answers[uid]) answers[uid] = defaultAnswer();
    return answers[uid];
  }
  function persist() { save(LS_ANS, answers); refreshCounts(); }

  // ── card ──────────────────────────────────────────────────────────
  function buildCard(item) {
    var a = ansFor(item.uid);
    var card = el("div", "card");
    card.dataset.uid = item.uid;

    // context line
    var ctx = el("div", "ctx");
    var site = el("span", "site", (item.site || "?") + (item.year ? "  ·  " + item.year : ""));
    var meta = el("span", null,
      "T" + (item.transect != null ? item.transect : "?") +
      (item.frame != null ? ("/" + String(item.frame).padStart(2, "0")) : "") );
    var badge = el("span", "badge", "needs ID");
    ctx.appendChild(site); ctx.appendChild(meta); ctx.appendChild(badge);
    card.appendChild(ctx);

    // viewer tools
    var tools = el("div", "vtools");
    tools.appendChild(el("span", null, "mask"));
    var slider = el("input"); slider.type = "range"; slider.min = 0; slider.max = 100;
    slider.value = Math.round(DEFAULT_OPACITY * 100);
    slider.title = "Mask fill opacity";
    tools.appendChild(slider);
    var fullBtn = el("button", null, "Show whole frame");
    tools.appendChild(fullBtn);
    card.appendChild(tools);

    // viewer surface
    var view = el("div", "viewer");
    var wrap = el("div", "imgwrap");
    var canvas = el("canvas");
    wrap.appendChild(canvas);
    view.appendChild(wrap);
    var fullImg = el("img", "full"); fullImg.style.display = "none"; fullImg.alt = "full frame";
    if (item.full) fullImg.src = item.full;
    view.appendChild(fullImg);
    card.appendChild(view);

    // composited closeup
    var cropImg = new Image(), maskImg = new Image(), loaded = { crop: false, mask: false };
    function redraw() {
      if (!loaded.crop) return;
      var w = cropImg.naturalWidth, h = cropImg.naturalHeight;
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(cropImg, 0, 0, w, h);
      if (loaded.mask) {
        var off = document.createElement("canvas"); off.width = w; off.height = h;
        var octx = off.getContext("2d");
        octx.drawImage(maskImg, 0, 0, w, h);
        octx.globalCompositeOperation = "source-in";
        octx.fillStyle = FILL; octx.fillRect(0, 0, w, h);
        ctx.globalAlpha = slider.value / 100;
        ctx.drawImage(off, 0, 0);
        ctx.globalAlpha = 1;
      }
    }
    cropImg.onload = function () { loaded.crop = true; redraw(); };
    maskImg.onload = function () { loaded.mask = true; redraw(); };
    cropImg.onerror = function () { wrap.appendChild(el("div", "empty", "image unavailable")); };
    if (item.crop) cropImg.src = item.crop;
    if (item.mask) maskImg.src = item.mask;
    slider.addEventListener("input", redraw);
    fullBtn.addEventListener("click", function () {
      var showing = fullImg.style.display !== "none";
      fullImg.style.display = showing ? "none" : "block";
      wrap.style.display = showing ? "" : "none";
      fullBtn.classList.toggle("on", !showing);
      fullBtn.textContent = showing ? "Show whole frame" : "Show close-up";
    });

    // ── labeling form ──
    var form = el("div", "form");
    var opts = el("div", "opts");

    function setCode(code, answered) {
      a.code = code; a.skipped = false; a.answered = answered !== false;
      syncUI(); persist();
    }

    // featured (target) codes first
    (item.featured_codes || []).forEach(function (code) {
      var info = BYCODE[code] || { name: "" };
      var o = el("div", "opt");
      o.dataset.code = code;
      o.appendChild(el("span", "code", code));
      if (info.name) { o.appendChild(el("span", "nm", info.name)); }
      o.title = (info.name || code) + (info.category ? " (" + info.category + ")" : "");
      o.addEventListener("click", function () { setCode(code, true); });
      opts.appendChild(o);
    });
    // I don't know
    var idk = el("div", "opt idk"); idk.dataset.code = CODES.idk.code;
    idk.appendChild(el("span", "code", CODES.idk.label));
    idk.title = "Use when you cannot determine the ID from the image.";
    idk.addEventListener("click", function () { setCode(CODES.idk.code, true); });
    opts.appendChild(idk);
    // Something else
    var elseOpt = el("div", "opt else"); elseOpt.dataset.code = "__else__";
    elseOpt.appendChild(el("span", "code", CODES.something_else.label));
    elseOpt.title = "Pick any other code from the full list, grouped by category.";
    opts.appendChild(elseOpt);
    form.appendChild(el("div", "lbl", "Identification"));
    form.appendChild(opts);

    // nested "something else" picker
    var elseBox = el("div", "elsebox");
    var grpSel = el("select"); grpSel.title = "Group";
    grpSel.appendChild(new Option("— group —", ""));
    CODES.groups.forEach(function (g) { grpSel.appendChild(new Option(g.group, g.group)); });
    var codeSel = el("select"); codeSel.title = "Code"; codeSel.disabled = true;
    codeSel.appendChild(new Option("— code —", ""));
    var chosen = el("span", "chosen", "");
    elseBox.appendChild(grpSel); elseBox.appendChild(codeSel); elseBox.appendChild(chosen);
    form.appendChild(elseBox);

    elseOpt.addEventListener("click", function () { elseBox.classList.add("show"); });
    grpSel.addEventListener("change", function () {
      codeSel.innerHTML = ""; codeSel.appendChild(new Option("— code —", ""));
      var g = CODES.groups.filter(function (x) { return x.group === grpSel.value; })[0];
      if (g) { g.codes.forEach(function (c) {
        var info = BYCODE[c] || {}; codeSel.appendChild(new Option(c + " — " + (info.name || ""), c));
      }); }
      codeSel.disabled = !g;
    });
    codeSel.addEventListener("change", function () {
      if (codeSel.value) { setCode(codeSel.value, true);
        chosen.textContent = "✓ " + codeSel.value + " — " + ((BYCODE[codeSel.value] || {}).name || ""); }
    });

    // confidence + skip
    var row = el("div", "row");
    var conf = el("div", "conf");
    var hi = el("button", "high", "High");
    hi.title = CODES.confidence.high.definition;
    var lo = el("button", "low", "Low");
    lo.title = CODES.confidence.low.definition;
    hi.addEventListener("click", function () { a.conf = "high"; a.answered = true; syncUI(); persist(); });
    lo.addEventListener("click", function () { a.conf = "low"; a.answered = true; syncUI(); persist(); });
    conf.appendChild(el("span", "lbl", "Confidence")); conf.appendChild(hi); conf.appendChild(lo);
    row.appendChild(conf);
    var skip = el("button", "skipbtn", "Skip");
    skip.title = "Not sure — exclude this mask from your results.";
    skip.addEventListener("click", function () {
      a.skipped = !a.skipped; a.answered = false; syncUI(); persist();
    });
    row.appendChild(skip);
    form.appendChild(row);
    card.appendChild(form);

    function syncUI() {
      Array.prototype.forEach.call(opts.children, function (o) {
        var c = o.dataset.code;
        var isElse = c === "__else__";
        var selByCode = !isElse && a.code === c && !a.skipped;
        var selByElse = isElse && a.answered && !a.skipped &&
          (item.featured_codes || []).indexOf(a.code) < 0 && a.code !== CODES.idk.code;
        o.classList.toggle("sel", selByCode || selByElse);
      });
      hi.classList.toggle("sel", a.conf === "high");
      lo.classList.toggle("sel", a.conf === "low");
      skip.classList.toggle("sel", !!a.skipped);
      card.classList.toggle("skip", !!a.skipped);
      var done = a.answered && !a.skipped;
      card.classList.toggle("done", done);
      badge.textContent = a.skipped ? "skipped" : (done ? (a.code) : "needs ID");
      badge.classList.toggle("ok", done);
    }
    syncUI();
    return card;
  }

  // ── counts / progress ───────────────────────────────────────────
  function tally() {
    var total = MANIFEST.items.length, answered = 0, skipped = 0;
    MANIFEST.items.forEach(function (it) {
      var a = answers[it.uid]; if (!a) return;
      if (a.skipped) skipped++; else if (a.answered) answered++;
    });
    return { total: total, answered: answered, skipped: skipped };
  }
  function refreshCounts() {
    var t = tally();
    document.getElementById("counts").innerHTML =
      "<strong>" + t.total + "</strong> masks to review";
    document.getElementById("progress").textContent =
      t.answered + " identified · " + t.skipped + " skipped · " +
      (t.total - t.answered - t.skipped) + " remaining";
  }

  // ── CSV export ────────────────────────────────────────────────────
  function exportCSV() {
    var rows = [["uid", "code", "confidence"]];
    MANIFEST.items.forEach(function (it) {
      var a = answers[it.uid];
      if (!a || a.skipped || !a.answered) return;   // only submitted IDs
      rows.push([it.uid, a.code, a.conf]);
    });
    if (rows.length === 1) {
      alert("No IDs to export yet. Pick a code on at least one card (Skip and "
            + "untouched cards are not exported).");
      return;
    }
    var csv = rows.map(function (r) {
      return r.map(function (v) {
        v = String(v == null ? "" : v);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(",");
    }).join("\n");
    var name = "tcrmp_expert_ids.csv";
    var blob = new Blob([csv], { type: "text/csv" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a"); a.href = url; a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    showModal(name, rows.length - 1);
  }

  function showModal(csvName, n) {
    var contacts = (MANIFEST.contacts || []).filter(Boolean);
    document.getElementById("csvName").textContent = csvName;
    var list = document.getElementById("contactList"); list.innerHTML = "";
    contacts.forEach(function (c) { list.appendChild(el("li", null, c)); });
    var subject = encodeURIComponent("TCRMP coral expert IDs — " + n + " labels");
    var body = encodeURIComponent(
      "Hi,\n\nAttached is my expert ID CSV (" + csvName + ") with " + n +
      " identifications from the TCRMP coral review.\n\n(Please remember to attach the downloaded file.)\n");
    document.getElementById("mailtoLink").href =
      "mailto:" + contacts.join(",") + "?subject=" + subject + "&body=" + body;
    document.getElementById("exportModal").hidden = false;
  }

  // ── boot ──────────────────────────────────────────────────────────
  function boot() {
    document.getElementById("exportBtn").addEventListener("click", exportCSV);
    document.getElementById("closeModal").addEventListener("click", function () {
      document.getElementById("exportModal").hidden = true;
    });

    Promise.all([getJSON("codes.json"), getJSON("review_manifest.json")])
      .then(function (res) {
        CODES = res[0]; MANIFEST = res[1];
        (CODES.codes || []).forEach(function (c) { BYCODE[c.code] = c; });
        var host = document.getElementById("cards");
        host.innerHTML = "";
        if (!MANIFEST.items || !MANIFEST.items.length) {
          host.appendChild(el("div", "empty",
            "Nothing to review right now — all masks have been identified. Thank you!"));
          refreshCounts(); return;
        }
        MANIFEST.items.forEach(function (it) { host.appendChild(buildCard(it)); });
        refreshCounts();
      })
      .catch(function (e) {
        document.getElementById("cards").appendChild(
          el("div", "empty", "Could not load review data: " + e.message));
      });
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
