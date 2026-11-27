/* Loads the Christmas Crawl lineup and the stands it points at.
 *
 * The stand list is the same source js/map.js uses: the live feed first,
 * data/stands.json only if that feed is empty or unreachable. Who is ON the
 * crawl is data/crawl2026.json — edit that file, not this one.
 *
 * Keep LIVE and FALLBACK in step with js/map.js. This page must not grow a
 * third copy of the farmstand list.
 */
(function (root) {
  var LIVE = "https://farmhousegetawaysapp.netlify.app/.netlify/functions/stands";
  var FALLBACK = "/data/stands.json";
  var CONFIG = "/data/crawl2026.json";

  function fetchJSON(url, ms) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ms || 8000) : null;
    return fetch(url, ctrl ? { signal: ctrl.signal } : undefined).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  function loadStands() {
    return fetchJSON(LIVE, 8000).then(function (d) {
      if (d && d.stands && d.stands.length) return { stands: d.stands, source: "live" };
      throw new Error("empty");
    }).catch(function () {
      return fetchJSON(FALLBACK, 8000).then(function (d) {
        return { stands: (d && d.stands) || [], source: "fallback" };
      });
    });
  }

  function loadCrawl() {
    return Promise.all([fetchJSON(CONFIG, 8000), loadStands()]).then(function (pair) {
      var config = pair[0] || {};
      var feed = pair[1];
      var logic = root.CrawlLogic;
      var result = logic.matchParticipants(feed.stands, config.participants || []);
      logic.applyHideHours(result.matched, config.hideHours);
      return {
        placeholder: config.placeholder !== false,
        date: config.date || "",
        time: config.time || "",
        start: config.start || "",
        prizes: config.prizes || "",
        firstStop: config.firstStop || "",
        showStands: config.showStands === true,
        source: feed.source,
        matched: logic.pinFirst(result.matched, config.firstStop),
        route: logic.routeFromFirst(result.matched, config.firstStop),
        missing: result.missing
      };
    });
  }

  root.CrawlData = {
    loadCrawl: loadCrawl,
    LIVE: LIVE,
    FALLBACK: FALLBACK,
    CONFIG: CONFIG
  };
})(typeof self !== "undefined" ? self : this);
