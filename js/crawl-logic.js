/* Pure helpers for the Christmas Crawl. No DOM, no network.
 *
 * The lineup lives in data/crawl2026.json. This file only decides how a
 * name, id, or slug in that list is matched to a stand, how a drive is
 * ordered from where someone is standing, and when a stop counts as reached.
 *
 * Loaded as a plain script in the browser (window.CrawlLogic) and as a
 * CommonJS module by js/crawl-logic.test.mjs.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CrawlLogic = api;
})(typeof self !== "undefined" ? self : this, function () {
  /* About a hundred yards. Inside the 75–100 m window the crawl asked for. */
  var ARRIVE_METERS = 90;
  /* A fix worse than this could be a house away from the pin. Don't auto-stamp it. */
  var ACCURACY_CUTOFF = 100;

  function norm(s) {
    return String(s == null ? "" : s)
      .replace(/[’‘]/g, "'")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function slugify(s) {
    return norm(s)
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  /* Prefer a real id when the feed has one, so a renamed stand still resumes.
     The live feed today has no ids; names are the key until it does. */
  function standKey(s) {
    if (!s) return "";
    if (s.id != null && String(s.id).trim() !== "") return "id:" + String(s.id).trim();
    return "name:" + norm(s.name);
  }

  /* Same longitude guard as js/map.js. A missing minus sign would plot the
     pin in China. Out-of-range stands stay on the list and off the map. */
  function saneStand(s) {
    var o = {};
    var k;
    for (k in s) if (Object.prototype.hasOwnProperty.call(s, k)) o[k] = s[k];
    if (o.lat == null || o.lng == null || o.lat === "" || o.lng === "") {
      o.lat = null;
      o.lng = null;
      return o;
    }
    o.lat = Number(o.lat);
    o.lng = Number(o.lng);
    if (!isFinite(o.lat) || !isFinite(o.lng)) {
      o.lat = null;
      o.lng = null;
      return o;
    }
    if (o.lng > 0 && o.lat > 20 && o.lat < 50) o.lng = -o.lng;
    if (o.lat < 32 || o.lat > 34.5 || o.lng < -118.5 || o.lng > -115.5) o.outOfRange = true;
    return o;
  }

  function located(s) {
    return !!(s && s.lat != null && s.lng != null && !s.outOfRange && isFinite(s.lat) && isFinite(s.lng));
  }

  function entryBits(entry) {
    if (entry && typeof entry === "object") {
      return {
        name: String(entry.name || "").trim(),
        match: String(entry.match || "").trim(),
        instagram: String(entry.instagram || "").replace(/^@/, "").trim()
      };
    }
    var raw = entry == null ? "" : String(entry).trim();
    return { name: raw, match: "", instagram: "" };
  }

  function igHandle(value) {
    var s = String(value || "");
    var m = s.match(/instagram\.com\/([^/?#]+)/i);
    s = m ? m[1] : s;
    return norm(s).replace(/^@/, "").replace(/_+$/g, "");
  }

  function sameHandle(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    var short = a.length < b.length ? a : b;
    var long = a.length < b.length ? b : a;
    return short.length >= 8 && long.indexOf(short) !== -1;
  }

  function standHandles(s) {
    return [s.instagram, s.url, s.facebook].map(igHandle).filter(Boolean);
  }

  function textHit(wantRaw, s) {
    var want = norm(wantRaw);
    var wantSlug = slugify(wantRaw);
    if (!want) return false;
    var id = s.id == null ? "" : String(s.id).trim();
    var slug = s.slug == null ? "" : String(s.slug).trim();
    if (id && (id === wantRaw || norm(id) === want)) return true;
    if (slug && (norm(slug) === want || slugify(slug) === wantSlug)) return true;
    return norm(s.name) === want || slugify(s.name) === wantSlug;
  }

  function matchParticipants(stands, entries) {
    var pool = (stands || []).map(saneStand).filter(function (s) { return s && s.name; });
    var used = {};
    var matched = [];
    var missing = [];
    (entries || []).forEach(function (entry) {
      var bits = entryBits(entry);
      if (!bits.name && !bits.match && !bits.instagram) return;
      var labels = [bits.match, bits.name].filter(Boolean);
      var found = null;
      var i, j;
      for (i = 0; i < pool.length && !found; i++) {
        var s = pool[i];
        var key = standKey(s);
        if (used[key]) continue;
        for (j = 0; j < labels.length; j++) {
          if (textHit(labels[j], s)) { found = s; break; }
        }
        if (!found && bits.instagram) {
          var wantHandle = igHandle(bits.instagram);
          var handles = standHandles(s);
          for (j = 0; j < handles.length; j++) {
            if (sameHandle(wantHandle, handles[j])) { found = s; break; }
          }
        }
      }
      if (!found) {
        missing.push(bits.instagram ? { name: bits.name, instagram: bits.instagram } : bits.name);
      } else {
        used[standKey(found)] = 1;
        if (bits.name) found.crawlName = bits.name;
        if (bits.instagram) found.crawlInstagram = bits.instagram;
        matched.push(found);
      }
    });
    return { matched: matched, missing: missing };
  }

  function haversine(a, b) {
    var R = 6371000;
    var p1 = a.lat * Math.PI / 180;
    var p2 = b.lat * Math.PI / 180;
    var dp = (b.lat - a.lat) * Math.PI / 180;
    var dl = (b.lng - a.lng) * Math.PI / 180;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) +
            Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /* Degrees clockwise from north. */
  function bearing(a, b) {
    var p1 = a.lat * Math.PI / 180;
    var p2 = b.lat * Math.PI / 180;
    var dl = (b.lng - a.lng) * Math.PI / 180;
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function pathLength(origin, route) {
    if (!route.length) return 0;
    var n = haversine(origin, route[0]);
    var i;
    for (i = 0; i < route.length - 1; i++) n += haversine(route[i], route[i + 1]);
    return n;
  }

  function nearestNeighbor(origin, stands) {
    var left = stands.slice();
    var route = [];
    var cursor = origin;
    while (left.length) {
      var best = 0;
      var bestD = Infinity;
      var i;
      for (i = 0; i < left.length; i++) {
        var d = haversine(cursor, left[i]);
        if (d < bestD) { bestD = d; best = i; }
      }
      var pick = left.splice(best, 1)[0];
      route.push(pick);
      cursor = pick;
    }
    return route;
  }

  /* Open-path 2-opt. The crawl does not return to the start. n is tiny
     (a handful of stands), so restarting the scan after each improvement
     is plenty. */
  function twoOpt(origin, route) {
    var improved = true;
    var guard = 0;
    while (improved && guard++ < 40) {
      improved = false;
      var i, k;
      for (i = 0; i < route.length - 1 && !improved; i++) {
        for (k = i + 1; k < route.length; k++) {
          var next = route.slice(0, i).concat(route.slice(i, k + 1).reverse(), route.slice(k + 1));
          if (pathLength(origin, next) + 0.5 < pathLength(origin, route)) {
            route = next;
            improved = true;
            break;
          }
        }
      }
    }
    return route;
  }

  /* origin is {lat, lng} or null. Without a location, the config order stands.
     The anchor stop is not in this list — routeFromFirst holds it out. */
  function optimizeOrder(origin, stands) {
    var list = (stands || []).slice();
    if (!origin || !isFinite(origin.lat) || !isFinite(origin.lng)) return list;
    var pins = [];
    var rest = [];
    list.forEach(function (s) { (located(s) ? pins : rest).push(s); });
    if (pins.length < 2) return pins.concat(rest);
    return twoOpt(origin, nearestNeighbor(origin, pins)).concat(rest);
  }

  /* firstStop is a name, slug, id, or Instagram handle from the crawl file.
     "mini-barn-market" matches Mini Barn Market. */
  function isFirstStop(s, token) {
    var raw = String(token || "").trim();
    if (!raw || !s) return false;
    var want = norm(raw);
    var slug = slugify(raw);
    var fields = [s.name, s.crawlName, s.slug, s.id, s.crawlInstagram];
    var i;
    for (i = 0; i < fields.length; i++) {
      if (fields[i] == null || String(fields[i]).trim() === "") continue;
      var n = String(fields[i]);
      if (norm(n) === want || slugify(n) === slug) return true;
    }
    return false;
  }

  /* hideHours in the crawl file is the same kind of token as firstStop.
     Hours are cleared on the crawl copies only. The farmstand map is untouched. */
  function applyHideHours(stands, tokens) {
    var list = tokens || [];
    if (!list.length) return stands;
    (stands || []).forEach(function (s) {
      var i;
      for (i = 0; i < list.length; i++) {
        if (isFirstStop(s, list[i])) { s.hours = ""; break; }
      }
    });
    return stands;
  }

  function pinFirst(stands, token) {
    var list = (stands || []).slice();
    var anchor = null;
    var i;
    for (i = 0; i < list.length; i++) {
      if (isFirstStop(list[i], token)) { anchor = list[i]; break; }
    }
    if (!anchor) return list;
    return [anchor].concat(list.filter(function (s) { return s !== anchor; }));
  }

  /* Default drive: the configured stop stays first. The rest is the short
     drive onward from that stand, not from wherever the phone is. */
  function routeFromFirst(stands, token) {
    var pinned = pinFirst(stands, token);
    if (!pinned.length || !isFirstStop(pinned[0], token) || !located(pinned[0])) return pinned;
    var anchor = pinned[0];
    return [anchor].concat(optimizeOrder(anchor, pinned.slice(1)));
  }

  function lookupTable(stands) {
    var by = {};
    (stands || []).forEach(function (s) {
      by[standKey(s)] = s;
      by["name:" + norm(s.name)] = s;
      if (s.id != null && String(s.id).trim() !== "") by["id:" + String(s.id).trim()] = s;
      if (s.slug) by["slug:" + norm(s.slug)] = s;
    });
    return by;
  }

  /* saved: { order: [keys], visited: [keys], started: bool } or null.
     Unknown keys are dropped. Stands that weren't in the save are appended
     so a newly added participant shows up on a phone that already started. */
  function reconcile(saved, stands) {
    var by = lookupTable(stands);
    var order = [];
    var seen = {};
    var keys = (saved && saved.order) || [];
    keys.forEach(function (k) {
      var s = by[String(k)];
      if (!s) return;
      var id = standKey(s);
      if (seen[id]) return;
      seen[id] = 1;
      order.push(s);
    });
    (stands || []).forEach(function (s) {
      var id = standKey(s);
      if (seen[id]) return;
      seen[id] = 1;
      order.push(s);
    });
    var visited = {};
    ((saved && saved.visited) || []).forEach(function (k) {
      var s = by[String(k)];
      if (s) visited[standKey(s)] = true;
    });
    return { order: order, visited: visited, started: !!(saved && saved.started) };
  }

  function formatMiles(meters) {
    if (meters == null || !isFinite(meters)) return "";
    var miles = meters / 1609.344;
    if (miles < 0.1) {
      var feet = Math.round(meters * 3.28084 / 10) * 10;
      if (feet < 50) return "right here";
      return feet + " ft";
    }
    if (miles < 10) return (Math.round(miles * 10) / 10).toFixed(1) + " mi";
    return Math.round(miles) + " mi";
  }

  function formatEta(seconds) {
    if (seconds == null || !isFinite(seconds) || seconds < 0) return "";
    var min = Math.round(seconds / 60);
    if (min < 1) return "under a minute";
    if (min < 60) return "about " + min + " min";
    var h = Math.floor(min / 60);
    var m = min % 60;
    if (!m) return "about " + h + " hr";
    return "about " + h + " hr " + m + " min";
  }

  /* Straight-line fallback: stretch the distance a bit for curves, then
     assume a slow Ramona pace (about 22 mph) so the guess isn't a freeway. */
  function estimateSeconds(meters) {
    if (meters == null || !isFinite(meters)) return null;
    return (meters * 1.35) / 10;
  }

  function shouldArrive(distanceMeters, accuracyMeters) {
    if (distanceMeters == null || !isFinite(distanceMeters)) return false;
    if (distanceMeters > ARRIVE_METERS) return false;
    if (accuracyMeters != null && isFinite(accuracyMeters) && accuracyMeters >= ACCURACY_CUTOFF) return false;
    return true;
  }

  function safeUrl(v) {
    var u = String(v == null ? "" : v).trim();
    if (!u) return "";
    if (u.indexOf("http://") !== 0 && u.indexOf("https://") !== 0) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return "";
      u = "https://" + u;
    }
    return u;
  }

  function telHref(phone) {
    var d = String(phone == null ? "" : phone).replace(/[^0-9+]/g, "");
    return d ? "tel:" + d : "";
  }

  return {
    ARRIVE_METERS: ARRIVE_METERS,
    ACCURACY_CUTOFF: ACCURACY_CUTOFF,
    norm: norm,
    slugify: slugify,
    standKey: standKey,
    saneStand: saneStand,
    located: located,
    matchParticipants: matchParticipants,
    pinFirst: pinFirst,
    applyHideHours: applyHideHours,
    routeFromFirst: routeFromFirst,
    haversine: haversine,
    bearing: bearing,
    optimizeOrder: optimizeOrder,
    reconcile: reconcile,
    formatMiles: formatMiles,
    formatEta: formatEta,
    estimateSeconds: estimateSeconds,
    shouldArrive: shouldArrive,
    safeUrl: safeUrl,
    telHref: telHref
  };
});
