/* Landing page for /crawl2026. Fills the stand cards and the date line
 * from data/crawl2026.json plus the same stand feed the map uses.
 * The tour itself is /crawl2026/map (js/crawl-tour.js).
 */
(function () {
  var list = document.getElementById("crawl-stands");
  if (!list || !window.CrawlLogic || !window.CrawlData) return;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function linkLabel(url) {
    if (/instagram\.com/i.test(url)) return "Instagram";
    if (/facebook\.com/i.test(url)) return "Facebook";
    return "Website";
  }

  function fillFact(id, value, empty) {
    var el = document.getElementById(id);
    if (el && value) el.textContent = value;
    else if (el && empty) el.textContent = empty;
  }

  function show(pack) {
    fillFact("tbd-date", pack.date, "Not set");
    fillFact("tbd-time", pack.time, "Not set");
    fillFact("tbd-start", pack.start, "Not set");
    fillFact("tbd-prizes", pack.prizes, "None announced");

    if (!pack.placeholder) {
      var note = document.getElementById("lineup-note");
      if (note) note.textContent = "These are the stands on the crawl. The name, the address, and the hours come from the farmstand map.";
      Array.prototype.forEach.call(document.querySelectorAll("[data-ph]"), function (el) {
        el.parentNode.removeChild(el);
      });
    }

    var count = document.getElementById("crawl-count");
    if (count) {
      count.textContent = pack.matched.length === 1
        ? "1 stand on the list"
        : pack.matched.length + " stands on the list";
    }

    if (!pack.matched.length) {
      list.innerHTML = '<li class="crawl-empty">None of the names in the crawl list matched a stand. The list is data/crawl2026.json.</li>';
    } else {
      list.innerHTML = pack.matched.map(function (s, i) {
        var bits = ['<li class="crawl-card">',
          '<span class="crawl-num">' + (i + 1) + "</span>",
          "<h3>" + esc(s.name) +
            (s.ours ? ' <span class="fsrow-ours">Ours</span>' : "") + "</h3>"];
        if (s.hours) bits.push('<p class="crawl-hours">' + esc(s.hours) + "</p>");
        if (s.address) bits.push('<p class="crawl-addr">' + esc(s.address) + "</p>");
        if (s.sells) bits.push('<p class="crawl-sells">' + esc(s.sells) + "</p>");
        var links = [];
        function add(href, label) {
          var u = CrawlLogic.safeUrl(href);
          if (!u) return;
          if (links.some(function (x) { return x.u === u; })) return;
          links.push({ u: u, label: label });
        }
        add(s.url, linkLabel(s.url || ""));
        add(s.instagram, "Instagram");
        add(s.facebook, "Facebook");
        var tel = CrawlLogic.telHref(s.phone);
        bits.push('<p class="crawl-links">');
        bits.push('<a href="/crawl2026/map#' + esc(CrawlLogic.slugify(s.name)) + '">On the tour map</a>');
        links.forEach(function (l) {
          bits.push('<a href="' + esc(l.u) + '" target="_blank" rel="noopener">' + esc(l.label) + "</a>");
        });
        if (tel) bits.push('<a href="' + esc(tel) + '">Call</a>');
        bits.push("</p></li>");
        return bits.join("");
      }).join("");
    }

    var miss = document.getElementById("crawl-missing");
    if (miss && pack.missing.length) {
      miss.hidden = false;
      miss.textContent = "Not on the map, so left off this page: " + pack.missing.join(", ") +
        ". Check the spelling in data/crawl2026.json.";
    }
  }

  function fail() {
    list.innerHTML = '<li class="crawl-empty">The stand list did not load. Refresh the page. The full map is still at <a href="/maps">/maps</a>.</li>';
  }

  CrawlData.loadCrawl().then(show).catch(fail);
})();
