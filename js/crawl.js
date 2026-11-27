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

  function standsOpen(pack) {
    return !!(CrawlLogic.previewBase() || (pack && pack.showStands));
  }

  function show(pack) {
    fillFact("tbd-date", pack.date, "Coming soon");
    fillFact("tbd-time", pack.time, "Coming soon");
    fillFact("tbd-prizes", pack.prizes, "");

    var open = standsOpen(pack);
    var soon = document.getElementById("crawl-soon");
    if (soon) soon.hidden = open;
    if (!open) {
      var soonLine = document.getElementById("crawl-soon-line");
      if (soonLine) soonLine.textContent = CrawlLogic.standCountLine(pack.participantCount);
    }
    Array.prototype.forEach.call(document.querySelectorAll(".needs-stands"), function (el) {
      el.hidden = !open;
    });
    var base = CrawlLogic.previewBase();
    if (base) {
      Array.prototype.forEach.call(document.querySelectorAll('a[href="/crawl2026"], a[href="/crawl2026/"]'), function (a) {
        a.setAttribute("href", base + "/");
      });
    }
    if (open) {
      document.body.classList.add("has-tour-go");
      var road = document.querySelector(".road");
      if (road && !road.getAttribute("data-ready")) {
        road.setAttribute("data-ready", "1");
        var light = function () { road.classList.add("lit"); };
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) light();
        else {
          var io = new IntersectionObserver(function (ents) {
            ents.forEach(function (e) {
              if (e.isIntersecting) { light(); io.disconnect(); }
            });
          }, { threshold: 0.3 });
          io.observe(road);
        }
      }
      var lede = document.getElementById("crawl-lede");
      if (lede) lede.textContent = "The Ramona Farm Stand Christmas Crawl is Saturday and Sunday, December 19 and 20, from 9 AM to 5 PM. Visit Ramona’s farm stands, all decorated for the holidays and stocked with local goodies.";
      var tour = document.getElementById("tour-link");
      if (tour && base) tour.href = base + "/map?start=1";
    }

    if (!pack.placeholder) {
      var note = document.getElementById("lineup-note");
      if (note) note.textContent = "Here are the stands taking part, with their address and hours.";
      Array.prototype.forEach.call(document.querySelectorAll("[data-ph]"), function (el) {
        el.parentNode.removeChild(el);
      });
    }

    if (!open) return;

    var total = pack.matched.length + pack.missing.length;

    function card(s, i, unmatched) {
      var name = unmatched ? (s.name || String(s)) : (s.crawlName || s.name);
      var bits = ['<li class="crawl-card' + (unmatched ? " crawl-unmatched" : "") + '">',
        '<span class="crawl-num">' + (i + 1) + "</span>",
        "<h3>" + esc(name) +
          (!unmatched && s.ours ? ' <span class="fsrow-ours">Ours</span>' : "") + "</h3>"];
      if (!unmatched && s.hours) bits.push('<p class="crawl-hours">' + esc(s.hours) + "</p>");
      if (!unmatched && s.address) bits.push('<p class="crawl-addr">' + esc(s.address) + "</p>");
      if (!unmatched && s.sells) bits.push('<p class="crawl-sells">' + esc(s.sells) + "</p>");
      if (unmatched) bits.push('<p class="crawl-addr">Not on the map yet.</p>');
      var links = [];
      function add(href, label) {
        var u = CrawlLogic.safeUrl(href);
        if (!u) return;
        if (links.some(function (x) { return x.u === u; })) return;
        links.push({ u: u, label: label });
      }
      if (!unmatched && CrawlLogic.located(s)) {
        bits.push('<p class="crawl-links">');
        var mapBase = (CrawlLogic.previewBase() || "/crawl2026") + "/map";
        bits.push('<a href="' + mapBase + '#' + esc(CrawlLogic.slugify(s.name)) + '">Show on the map</a>');
      } else {
        bits.push('<p class="crawl-links">');
      }
      var ig = unmatched ? (s.instagram || "") : (s.crawlInstagram || "");
      if (ig) add("https://www.instagram.com/" + String(ig).replace(/^@/, "") + "/", "Instagram");
      else if (!unmatched) add(s.instagram, "Instagram");
      if (!unmatched) {
        add(s.url, linkLabel(s.url || ""));
        add(s.facebook, "Facebook");
      }
      links.forEach(function (l) {
        bits.push('<a href="' + esc(l.u) + '" target="_blank" rel="noopener">' + esc(l.label) + "</a>");
      });
      if (!unmatched) {
        var tel = CrawlLogic.telHref(s.phone);
        if (tel) bits.push('<a href="' + esc(tel) + '">Call</a>');
      }
      bits.push("</p></li>");
      return bits.join("");
    }

    if (!total) {
      list.innerHTML = '<li class="crawl-empty">Refresh the page.</li>';
    } else {
      list.innerHTML = pack.matched.map(function (s, i) { return card(s, i, false); }).join("") +
        pack.missing.map(function (m, i) {
          var item = m && typeof m === "object" ? m : { name: String(m) };
          return card(item, pack.matched.length + i, true);
        }).join("");
    }

    var miss = document.getElementById("crawl-missing");
    if (miss) miss.hidden = true;
  }

  function fail() {
    list.innerHTML = '<li class="crawl-empty">Refresh the page, or open <a href="/maps">the Ramona map</a>.</li>';
  }

  CrawlData.loadCrawl().then(show).catch(fail);
})();
