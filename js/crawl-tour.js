/* Live tour for /crawl2026/map.
 *
 * Who appears: data/crawl2026.json (see js/crawl-data.js). This file does
 * not keep its own stand list.
 *
 * The drive line comes from the public OSRM demo
 * (https://router.project-osrm.org). If that request fails, the line is
 * straight and we stay quiet about it — shoppers just tap Directions.
 * That button opens Google Maps, or Apple Maps on an iPhone or iPad.
 *
 * Order and stamps are kept in localStorage under fstv-crawl-2026-v2 on
 * this phone only. v1 is ignored on purpose so a phone that tried an
 * earlier order starts fresh, with the configured first stop at the top.
 * Nothing is sent to a server.
 */
(function () {
  if (!window.CrawlLogic || !window.CrawlData) return;

  var KEY = "fstv-crawl-2026-v2";
  var OSRM = "https://router.project-osrm.org/route/v1/driving/";
  var CENTER = [33.03, -116.87];
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Same tiles as js/map.js. Streets is the default; the other two are
     there because the groves read better from above when you are choosing
     a turn. */
  var OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  var STYLES = {
    streets: {
      label: "Streets",
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attrib: OSM_ATTR, max: 19
    },
    terrain: {
      label: "Terrain",
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
      attrib: "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, USGS, NOAA", max: 19
    },
    satellite: {
      label: "Satellite",
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attrib: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics", max: 19
    }
  };

  var state = {
    original: [],
    stands: [],
    visited: {},
    skipped: {},
    active: false,
    missing: [],
    placeholder: true,
    user: null,
    heading: null,
    follow: true,
    watchId: null,
    wakeLock: null,
    map: null,
    markers: null,
    you: null,
    halo: null,
    legRoute: null,
    routeIsStraight: false,
    lastOrigin: null,
    lastFetchAt: 0,
    routedKey: "",
    celebrating: false,
    waitTimer: null
  };

  var routeLayers = [];
  var overviewLayers = [];
  var liveLayers = [];
  var youGlide = 0;
  var routeToken = 0;
  var fittedKey = "";
  var lastFit = null;
  var tileLayer = null;
  var drag = null;
  var scrollRaf = 0;
  var HOLD_MS = 360;
  var suppressClick = false;
  var el = {};

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isAppleMobile() {
    var ua = navigator.userAgent || "";
    if (/iPhone|iPod/.test(ua)) return true;
    return /iPad/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
  }

  function directionsURL(s) {
    var q = CrawlLogic.located(s) ? (s.lat + "," + s.lng) : (s.address || s.name || "");
    return isAppleMobile()
      ? "https://maps.apple.com/?daddr=" + encodeURIComponent(q) + "&dirflg=d"
      : "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(q);
  }

  function navLabel() {
    return "Directions";
  }

  function keyOf(s) { return CrawlLogic.standKey(s); }
  function shown(s) { return s ? (s.crawlName || s.name || "") : ""; }
  function isVis(s) { return !!state.visited[keyOf(s)]; }
  function isSkipped(s) { return !!(s && state.skipped[keyOf(s)]); }
  function isDone(s) { return isVis(s) || isSkipped(s); }
  function isAnchor(s) {
    if (!s) return false;
    return CrawlLogic.slugify(s.name) === "mini-barn-market" ||
      CrawlLogic.slugify(s.crawlName || "") === "mini-barn-market";
  }

  function visitedCount() {
    var n = 0;
    state.stands.forEach(function (s) { if (isVis(s)) n++; });
    return n;
  }

  function complete() {
    return state.stands.length > 0 && state.stands.every(isDone);
  }

  function nextStop() {
    var i;
    for (i = 0; i < state.stands.length; i++) if (!isDone(state.stands[i])) return state.stands[i];
    return null;
  }

  function unvisited() {
    return state.stands.filter(function (s) { return !isDone(s); });
  }

  function normalize() {
    var vis = [];
    var rest = [];
    var skipped = [];
    var anchor = null;
    state.stands.forEach(function (s) {
      if (isVis(s)) vis.push(s);
      else if (isSkipped(s)) skipped.push(s);
      else if (!anchor && isAnchor(s)) anchor = s;
      else rest.push(s);
    });
    if (anchor) rest.unshift(anchor);
    state.stands = vis.concat(rest, skipped);
  }

  function setStatus(msg) {
    if (el.status) el.status.textContent = msg || "";
  }

  function loadSaved() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || o.v !== 2) return null;
      return o;
    } catch (e) { return null; }
  }

  function save() {
    var order = state.stands.map(keyOf);
    var visited = [];
    var skipped = [];
    state.stands.forEach(function (s) {
      if (isVis(s)) visited.push(keyOf(s));
      else if (isSkipped(s)) skipped.push(keyOf(s));
    });
    try {
      localStorage.setItem(KEY, JSON.stringify({
        v: 2, order: order, visited: visited, skipped: skipped, started: !!state.active
      }));
    } catch (e) { /* private mode, full disk — the tour still runs */ }
  }

  function grab() {
    ["tour-progress", "tour-status", "tour-leg", "leg-kicker", "leg-name", "leg-meta",
     "leg-addr", "leg-hours", "leg-note", "leg-nav", "leg-stamp", "leg-skip",
     "btn-start", "btn-end", "btn-order", "btn-suggest", "btn-pick", "btn-reset", "btn-recenter",
     "pick-help", "tour-order", "tour-idle", "cel-name", "cel-detail", "cel-next",
     "crawl-missing"].forEach(function (id) {
      el[id] = document.getElementById(id);
    });
    el.progress = el["tour-progress"];
    el.status = el["tour-status"];
    el.leg = el["tour-leg"];
    el.kicker = el["leg-kicker"];
    el.name = el["leg-name"];
    el.meta = el["leg-meta"];
    el.addr = el["leg-addr"];
    el.hours = el["leg-hours"];
    el.note = el["leg-note"];
    el.nav = el["leg-nav"];
    el.stamp = el["leg-stamp"];
    el.skip = el["leg-skip"];
    el.start = el["btn-start"];
    el.end = el["btn-end"];
    el.orderBtn = el["btn-order"];
    el.suggest = el["btn-suggest"];
    el.pick = el["btn-pick"];
    el.reset = el["btn-reset"];
    el.recenter = el["btn-recenter"];
    el.help = el["pick-help"];
    el.order = el["tour-order"];
    el.idle = el["tour-idle"];
    el.celName = el["cel-name"];
    el.celDetail = el["cel-detail"];
    el.celNext = el["cel-next"];
    el.missing = el["crawl-missing"];
    el.dialog = document.getElementById("celebrate");
    el.map = document.getElementById("crawlmap");
  }

  function show(node, on) {
    if (node) node.classList.toggle("is-off", !on);
  }

  /* ---- map ---- */

  function initMap() {
    if (typeof L === "undefined" || !el.map) {
      if (el.map) {
        el.map.className = "fsmap-off";
        el.map.innerHTML = '<p class="fsfail">The map didn’t load. The list below still works. Tap Directions.</p>';
      }
      return;
    }
    var map = L.map(el.map, { scrollWheelZoom: false, attributionControl: true }).setView(CENTER, 12);
    state.map = map;
    map.createPane("routes");
    map.getPane("routes").style.zIndex = 410;
    map.createPane("you");
    map.getPane("you").style.zIndex = 650;
    state.markers = L.layerGroup().addTo(map);
    setStyle("streets");
    var box = document.getElementById("tour-styles");
    if (box) {
      box.innerHTML = Object.keys(STYLES).map(function (k) {
        return '<button type="button" class="fschip fschip-sm" data-style="' + k + '">' + STYLES[k].label + "</button>";
      }).join("");
      box.addEventListener("click", function (e) {
        var b = e.target.closest ? e.target.closest("[data-style]") : null;
        if (b) setStyle(b.getAttribute("data-style"));
      });
    }
    map.on("click", function () { map.scrollWheelZoom.enable(); });
    map.on("dragstart", function () { state.follow = false; });
    /* The sheet and the map share a flex row on a wide screen, so the
       container's real height often arrives a beat after Leaflet boots.
       Refit whatever we last framed, or the pins sit in a grey box. */
    setTimeout(function () {
      map.invalidateSize();
      if (lastFit && lastFit.length && state.follow) {
        if (lastFit.length === 1) map.setView(lastFit[0], 15, { animate: false });
        else map.fitBounds(lastFit, { padding: [42, 42], maxZoom: 15, animate: false });
      }
    }, 150);
    window.addEventListener("resize", function () { map.invalidateSize(); });
  }

  function setStyle(key) {
    if (!state.map) return;
    var st = STYLES[key] || STYLES.streets;
    if (tileLayer) state.map.removeLayer(tileLayer);
    tileLayer = L.tileLayer(st.url, { attribution: st.attrib, maxZoom: st.max || 19 }).addTo(state.map);
    var box = document.getElementById("tour-styles");
    if (box) Array.prototype.forEach.call(box.children, function (b) {
      b.classList.toggle("is-on", b.getAttribute("data-style") === key);
    });
  }

  function pinIcon(n, kind) {
    var html = kind === "visited"
      ? '<span class="pin pin-ornament"></span>'
      : '<span class="pin pin-' + kind + '">' + n + "</span>";
    return L.divIcon({
      className: "pin-wrap",
      html: html,
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });
  }

  function youIcon() {
    var h = (state.heading != null && isFinite(state.heading)) ? state.heading : 0;
    return L.divIcon({
      className: "you-wrap",
      html: '<span class="sleigh" style="transform:rotate(' + h.toFixed(1) + 'deg)">' +
        '<svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">' +
        '<path fill="#F6E2A4" d="M18 3l5 9H13z"/>' +
        '<rect x="7" y="12" width="22" height="8" rx="2" fill="#7E1E2E"/>' +
        '<path d="M9 20c2 7 16 7 18 0" fill="none" stroke="#E4C56A" stroke-width="2"/>' +
        '</svg></span>',
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
  }

  function popupHtml(s) {
    var bits = ['<div class="pop"><h3>' + esc(shown(s)) + "</h3>"];
    if (s.sells) bits.push('<p class="pop-sells">' + esc(s.sells) + "</p>");
    if (s.hours) bits.push('<p class="pop-hours">' + esc(s.hours) + "</p>");
    if (s.address) bits.push('<p class="pop-addr">' + esc(s.address) + "</p>");
    bits.push('<p class="pop-links"><a href="' + esc(directionsURL(s)) + '" target="_blank" rel="noopener">' +
      esc(navLabel()) + "</a></p></div>");
    return bits.join("");
  }

  function renderMarkers() {
    if (!state.markers) return;
    state.markers.clearLayers();
    var next = nextStop();
    state.stands.forEach(function (s, i) {
      s._marker = null;
      if (!CrawlLogic.located(s)) return;
      var kind = isVis(s) ? "visited" : (next && keyOf(next) === keyOf(s) ? "next" : "rest");
      var marker = L.marker([s.lat, s.lng], { icon: pinIcon(i + 1, kind), title: shown(s), zIndexOffset: kind === "next" ? 400 : 0 })
        .bindPopup(popupHtml(s))
        .addTo(state.markers);
      s._marker = marker;
    });
  }

  function glideYou(ll) {
    var from = state.you.getLatLng();
    if (reduced || !from) { state.you.setLatLng(ll); return; }
    var id = ++youGlide;
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    var dur = 700;
    var fLat = from.lat;
    var fLng = from.lng;
    function step(now) {
      if (id !== youGlide || !state.you) return;
      var t = Math.min(1, (now - t0) / dur);
      var e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      state.you.setLatLng([fLat + (ll[0] - fLat) * e, fLng + (ll[1] - fLng) * e]);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function drawUser() {
    if (!state.map || !state.user) return;
    var ll = [state.user.lat, state.user.lng];
    if (!state.you) {
      state.you = L.marker(ll, { icon: youIcon(), pane: "you", zIndexOffset: 800, title: "You are here" }).addTo(state.map);
    } else {
      glideYou(ll);
      state.you.setIcon(youIcon());
    }
    var acc = state.user.accuracy;
    if (isFinite(acc) && acc > 0 && acc <= 400) {
      if (!state.halo) {
        state.halo = L.circle(ll, {
          pane: "routes", radius: acc, color: "#1D4ED8", weight: 1,
          fillColor: "#1D4ED8", fillOpacity: 0.08
        }).addTo(state.map);
      } else {
        state.halo.setLatLng(ll);
        state.halo.setRadius(acc);
      }
    } else if (state.halo) {
      state.map.removeLayer(state.halo);
      state.halo = null;
    }
  }

  function clearYou() {
    if (state.you && state.map) state.map.removeLayer(state.you);
    if (state.halo && state.map) state.map.removeLayer(state.halo);
    state.you = null;
    state.halo = null;
  }

  function dropGroup(group) {
    group.forEach(function (layer) {
      if (state.map) state.map.removeLayer(layer);
    });
    group.length = 0;
  }

  function clearRoute() {
    dropGroup(overviewLayers);
    dropGroup(liveLayers);
    routeLayers = [];
  }

  function paintLine(group, coords, style) {
    if (!state.map || !coords || coords.length < 2) return;
    var s = { pane: "routes" };
    var k;
    for (k in style) if (Object.prototype.hasOwnProperty.call(style, k)) s[k] = style[k];
    group.push(L.polyline(coords, s).addTo(state.map));
  }

  function paintDone(group, coords) {
    paintLine(group, coords, { color: "#8A6420", weight: 11, opacity: 0.4, lineCap: "round", lineJoin: "round" });
    paintLine(group, coords, { color: "#F6E2A4", weight: 5, opacity: 1, lineCap: "round", lineJoin: "round" });
  }

  function paintSoon(group, coords) {
    paintLine(group, coords, {
      color: "#C6A15B", weight: 4, opacity: 0.75, dashArray: "7 9",
      lineCap: "round", lineJoin: "round"
    });
  }

  function fitIfNew(coords, key) {
    if (!state.follow || !state.map || !coords || !coords.length) return;
    if (fittedKey === key) return;
    fittedKey = key;
    lastFit = coords;
    state.map.invalidateSize();
    var opts = { padding: [42, 42], maxZoom: 15, animate: !reduced };
    if (coords.length === 1) state.map.setView(coords[0], 15, opts);
    else state.map.fitBounds(coords, opts);
  }

  function routePairs() {
    var stands = state.stands.filter(function (s) {
      return CrawlLogic.located(s) && !isSkipped(s);
    });
    var list = [];
    var i;
    for (i = 0; i < stands.length - 1; i++) {
      list.push({ a: stands[i], b: stands[i + 1], done: isVis(stands[i + 1]) });
    }
    return { stands: stands, pairs: list };
  }

  function straightPair(p) {
    return [[p.a.lat, p.a.lng], [p.b.lat, p.b.lng]];
  }

  function drawOverview(legs) {
    dropGroup(overviewLayers);
    legs.forEach(function (leg) {
      if (leg.done) paintDone(overviewLayers, leg.coords);
      else paintSoon(overviewLayers, leg.coords);
    });
  }

  function drawLive(coords) {
    dropGroup(liveLayers);
    if (coords) paintDone(liveLayers, coords);
  }

  function refreshRoute() {
    var token = ++routeToken;
    var pack = routePairs();
    var legs = pack.pairs.map(function (p) {
      return { coords: straightPair(p), done: p.done };
    });
    drawOverview(legs);

    var next = nextStop();
    if (state.active && state.user && next && CrawlLogic.located(next)) {
      var straightMeters = CrawlLogic.haversine(state.user, next);
      state.legRoute = {
        meters: straightMeters,
        seconds: CrawlLogic.estimateSeconds(straightMeters),
        fromOsrm: false,
        origin: { lat: state.user.lat, lng: state.user.lng }
      };
      state.routeIsStraight = true;
      var bee = [[state.user.lat, state.user.lng], [next.lat, next.lng]];
      drawLive(bee);
      updateLegReadout();
      fitIfNew(bee, keyOf(next) + ":bee");
      state.lastOrigin = { lat: state.user.lat, lng: state.user.lng };
      state.lastFetchAt = Date.now();
      state.routedKey = keyOf(next);
      osrm([state.user, next]).then(function (r) {
        if (token !== routeToken) return;
        r.origin = { lat: state.user.lat, lng: state.user.lng };
        state.legRoute = r;
        state.routeIsStraight = false;
        drawLive(r.coords);
        updateLegReadout();
        fitIfNew(r.coords, keyOf(next) + ":road");
      }).catch(function () { /* the straight line is already on the map */ });
    } else {
      state.legRoute = null;
      state.routeIsStraight = false;
      show(el.note, false);
      drawLive(null);
      if (!state.active && pack.stands.length) {
        fitIfNew(pack.stands.map(function (s) { return [s.lat, s.lng]; }), "all");
      }
    }

    if (pack.stands.length >= 2) {
      osrm(pack.stands).then(function (r) {
        if (token !== routeToken) return;
        var cuts = r.cuts || [];
        var nextLegs = pack.pairs.map(function (p, i) {
          var s = cuts[i];
          var e = cuts[i + 1];
          var slice = (isFinite(s) && isFinite(e)) ? r.coords.slice(s, e + 1) : straightPair(p);
          return { coords: slice.length >= 2 ? slice : straightPair(p), done: p.done };
        });
        drawOverview(nextLegs);
        if (!state.active) fitIfNew(r.coords, "all-road");
      }).catch(function () { /* the straight line is already down */ });
    }
  }

  function osrm(points) {
    var path = points.map(function (p) {
      return p.lng.toFixed(5) + "," + p.lat.toFixed(5);
    }).join(";");
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 7000) : null;
    return fetch(OSRM + path + "?overview=full&geometries=geojson", ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (r) {
        if (timer) clearTimeout(timer);
        if (!r.ok) throw new Error("osrm");
        return r.json();
      }, function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      }).then(function (d) {
        if (!d.routes || !d.routes[0] || !d.routes[0].geometry) throw new Error("osrm");
        var route = d.routes[0];
        return {
          coords: route.geometry.coordinates.map(function (c) { return [c[1], c[0]]; }),
          meters: route.distance,
          seconds: route.duration,
          fromOsrm: true,
          cuts: (d.waypoints || []).map(function (w) { return w.waypoint_index; })
        };
      });
  }

  function maybeReroute() {
    if (!state.active || !state.user) return;
    var next = nextStop();
    var key = next ? keyOf(next) : "";
    var moved = state.lastOrigin ? CrawlLogic.haversine(state.lastOrigin, state.user) : Infinity;
    var wait = Date.now() - (state.lastFetchAt || 0);
    if (key !== state.routedKey || (moved > 200 && wait > 12000)) refreshRoute();
  }

  function followEdge() {
    if (!state.follow || !state.map || !state.user) return;
    if (!state.map.getBounds().contains([state.user.lat, state.user.lng])) {
      state.map.panTo([state.user.lat, state.user.lng], { animate: !reduced, duration: reduced ? 0 : 0.4 });
    }
  }

  /* ---- location, arrival, wake lock ---- */

  function updateHeading(here) {
    var h = null;
    if (typeof here.heading === "number" && isFinite(here.heading) && here.heading >= 0 && here.speed > 0.4) {
      h = here.heading;
    } else if (state.user && CrawlLogic.haversine(state.user, here) >= 8) {
      h = CrawlLogic.bearing(state.user, here);
    }
    if (h != null) state.heading = h;
  }

  function onPos(pos) {
    var here = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: typeof pos.coords.accuracy === "number" ? pos.coords.accuracy : null,
      heading: pos.coords.heading,
      speed: typeof pos.coords.speed === "number" ? pos.coords.speed : 0
    };
    updateHeading(here);
    state.user = here;
    if (state.waitTimer) { clearTimeout(state.waitTimer); state.waitTimer = null; }
    if (el.status && /Finding you|Tap Directions anytime|can’t see where/.test(el.status.textContent || "")) setStatus("");
    drawUser();
    updateLegReadout();
    maybeReroute();
    maybeArrive();
    followEdge();
  }

  function onPosErr(err) {
    /* A timeout between fixes is normal, and a later error must not wipe a
       good position with a scary line. Only a hard refusal is worth saying. */
    if (err && err.code === 1) {
      setStatus("We can’t see where you are. Tap Directions, or stamp this stop when you get there.");
      return;
    }
    if (!state.user) {
      setStatus("Tap Directions anytime.");
    }
  }

  function armWait() {
    if (state.waitTimer) clearTimeout(state.waitTimer);
    state.waitTimer = setTimeout(function () {
      if (state.active && !state.user) {
        setStatus("We can’t see where you are. Tap Directions, or stamp this stop when you get there.");
      }
    }, 12000);
  }

  function requestWake() {
    if (!navigator.wakeLock || !navigator.wakeLock.request) return;
    navigator.wakeLock.request("screen").then(function (lock) {
      state.wakeLock = lock;
    }).catch(function () {});
  }

  function releaseWake() {
    var lock = state.wakeLock;
    state.wakeLock = null;
    if (lock && lock.release) lock.release().catch(function () {});
  }

  function startWatch() {
    if (complete()) return;
    state.active = true;
    save();
    requestWake();
    render();
    if (!navigator.geolocation) {
      setStatus("Tap Directions, or stamp each stop when you arrive.");
      refreshRoute();
      return;
    }
    if (state.watchId == null) {
      state.watchId = navigator.geolocation.watchPosition(onPos, onPosErr, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 20000
      });
    }
    if (!state.user) {
      setStatus("Finding you…");
      armWait();
    }
    refreshRoute();
  }

  function stopWatch() {
    if (state.watchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(state.watchId);
    }
    state.watchId = null;
    if (state.waitTimer) { clearTimeout(state.waitTimer); state.waitTimer = null; }
    releaseWake();
  }

  function endTour() {
    state.active = false;
    stopWatch();
    save();
    setStatus("Tour paused.");
    render();
    refreshRoute();
  }

  function legFigures() {
    var next = nextStop();
    if (!state.user || !next || !CrawlLogic.located(next)) return null;
    var straight = CrawlLogic.haversine(state.user, next);
    var route = state.legRoute;
    if (route && route.fromOsrm && route.origin && isFinite(route.meters) && isFinite(route.seconds)) {
      var base = CrawlLogic.haversine(route.origin, next) || straight;
      var ratio = base > 1 ? Math.min(1.25, straight / base) : 1;
      return { meters: route.meters * ratio, seconds: route.seconds * ratio };
    }
    return { meters: straight, seconds: CrawlLogic.estimateSeconds(straight) };
  }

  function updateLegReadout() {
    if (!el.meta) return;
    var fig = legFigures();
    if (!fig) {
      el.meta.textContent = "";
      return;
    }
    el.meta.textContent = CrawlLogic.formatMiles(fig.meters) + " \u00b7 " + CrawlLogic.formatEta(fig.seconds);
  }

  function maybeArrive() {
    if (!state.active || state.celebrating || !state.user) return;
    var next = nextStop();
    if (!next || !CrawlLogic.located(next)) return;
    var d = CrawlLogic.haversine(state.user, next);
    if (CrawlLogic.shouldArrive(d, state.user.accuracy)) stamp(next);
  }

  function stamp(stand) {
    var key = keyOf(stand);
    if (!stand || state.visited[key] || state.celebrating) return;
    state.visited[key] = true;
    state.celebrating = true;
    normalize();
    save();
    var nxt = nextStop();
    if (el.celName) el.celName.textContent = shown(stand);
    if (el.celDetail) {
      el.celDetail.textContent = nxt
        ? "Next up is " + shown(nxt) + "."
        : "That was the last stand.";
    }
    if (el.celNext) el.celNext.textContent = nxt ? "On to the next stand" : "Done";
    openCelebrate();
    render();
    refreshRoute();
  }

  function openCelebrate() {
    var dialog = el.dialog;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else dialog.setAttribute("open", "");
    if (el.celNext) el.celNext.focus();
  }

  function onCelebrateClosed() {
    state.celebrating = false;
    if (complete()) {
      state.active = false;
      stopWatch();
      save();
      setStatus("You’ve visited every stand.");
    }
    render();
    maybeArrive();
  }

  function closeCelebrate() {
    var dialog = el.dialog;
    if (!dialog) { onCelebrateClosed(); return; }
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else {
      dialog.removeAttribute("open");
      onCelebrateClosed();
    }
  }

  /* ---- order ---- */

  function applySuggestion() {
    state.stands = state.original.slice();
    save();
    render();
    refreshRoute();
  }

  function moveKey(key, dir) {
    var i = -1;
    var n;
    for (n = 0; n < state.stands.length; n++) if (keyOf(state.stands[n]) === key) i = n;
    if (i < 0) return;
    if (isAnchor(state.stands[i]) || isDone(state.stands[i])) return;
    var j = i + dir;
    if (j < 0 || j >= state.stands.length) return;
    if (isDone(state.stands[j]) || isAnchor(state.stands[j])) return;
    var tmp = state.stands[i];
    state.stands[i] = state.stands[j];
    state.stands[j] = tmp;
    normalize();
    save();
    render();
    refreshRoute();
  }

  function skipStop() {
    var next = nextStop();
    if (!next || isAnchor(next)) return;
    state.skipped[keyOf(next)] = true;
    normalize();
    save();
    render();
    refreshRoute();
    if (complete()) {
      state.active = false;
      stopWatch();
      save();
      setStatus("You’ve visited every stand.");
    }
  }

  function commitDomOrder() {
    if (!el.order) return;
    var by = {};
    state.stands.forEach(function (s) { by[keyOf(s)] = s; });
    var next = [];
    Array.prototype.forEach.call(el.order.querySelectorAll("li"), function (li) {
      var s = by[li.getAttribute("data-key")];
      if (s) next.push(s);
    });
    state.stands.forEach(function (s) {
      if (next.indexOf(s) < 0) next.push(s);
    });
    state.stands = next;
    normalize();
    save();
    render();
    refreshRoute();
  }

  function focusStand(key) {
    var s = null;
    var i;
    for (i = 0; i < state.stands.length; i++) if (keyOf(state.stands[i]) === key) s = state.stands[i];
    if (!s || !s._marker || !state.map) return;
    state.follow = false;
    state.map.flyTo([s.lat, s.lng], 15, { duration: reduced ? 0 : 0.55, animate: !reduced });
    s._marker.openPopup();
  }

  function ensureFix(cb) {
    if (state.user) { cb(state.user); return; }
    if (!navigator.geolocation) { cb(null); return; }
    setStatus("Finding you…");
    navigator.geolocation.getCurrentPosition(function (pos) {
      onPos(pos);
      setStatus("");
      cb(state.user);
    }, function () {
      setStatus("We’ll keep this order.");
      cb(null);
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 });
  }

  function startOver() {
    if (!window.confirm("Start over?")) return;
    stopWatch();
    state.active = false;
    state.visited = {};
    state.skipped = {};
    state.stands = state.original.slice();
    state.celebrating = false;
    state.user = null;
    state.heading = null;
    state.legRoute = null;
    state.lastOrigin = null;
    state.routedKey = "";
    fittedKey = "";
    clearYou();
    if (el.dialog && el.dialog.open && el.dialog.close) el.dialog.close();
    try { localStorage.removeItem(KEY); } catch (e) {}
    setStatus("");
    render();
    refreshRoute();
  }

  function recenter() {
    state.follow = true;
    fittedKey = "";
    var next = nextStop();
    if (state.active && state.user && next && CrawlLogic.located(next)) {
      fitIfNew([[state.user.lat, state.user.lng], [next.lat, next.lng]], "recenter-" + Date.now());
    } else if (state.user) {
      fitIfNew([[state.user.lat, state.user.lng]], "recenter-" + Date.now());
    } else {
      var pts = state.stands.filter(CrawlLogic.located).map(function (s) { return [s.lat, s.lng]; });
      fitIfNew(pts, "recenter-" + Date.now());
    }
  }

  function openHash() {
    var h = "";
    try { h = decodeURIComponent((location.hash || "").replace(/^#/, "")); } catch (e) { h = ""; }
    if (!h) return;
    var i, s = null;
    for (i = 0; i < state.stands.length; i++) {
      if (CrawlLogic.slugify(state.stands[i].name) === h) { s = state.stands[i]; break; }
    }
    if (s && s._marker && state.map) {
      state.follow = false;
      state.map.setView([s.lat, s.lng], 15, { animate: !reduced });
      s._marker.openPopup();
    }
  }

  /* ---- sheet ---- */

  function render() {
    normalize();
    var next = nextStop();
    var nVis = visitedCount();
    var done = complete();

    var doneLine = nVis === 0 ? "" : (nVis === 1 ? "1 stop done" : nVis + " stops done");
    if (el.progress) el.progress.textContent = doneLine;
    var dots = document.getElementById("stamp-dots");
    var cardLabel = document.getElementById("stamp-card-label");
    if (dots) {
      var marks = "";
      state.stands.forEach(function (s) {
        marks += '<i class="' + (isVis(s) ? "is-on" : (isSkipped(s) ? "is-skip" : "")) + '"></i>';
      });
      dots.innerHTML = marks;
    }
    if (cardLabel) cardLabel.textContent = doneLine || "Collect a stamp at every stop.";

    if (el.idle) {
      if (!state.stands.length) {
        el.idle.textContent = "Refresh the page.";
        show(el.idle, true);
      } else if (done) {
        el.idle.textContent = "You’ve visited every stand.";
        show(el.idle, true);
      } else if (!state.active) {
        el.idle.textContent = "The tour starts at Mini Barn Market.";
        show(el.idle, true);
      } else {
        show(el.idle, false);
      }
    }

    show(el.leg, !!next);
    if (next && el.name) {
      el.kicker.textContent = (!state.active && nVis === 0) ? "First stop" : "Next stop";
      el.name.textContent = shown(next);
      el.addr.textContent = next.address || "";
      el.hours.textContent = next.hours || "";
      show(el.hours, !!next.hours);
      if (el.nav) {
        el.nav.href = directionsURL(next);
        el.nav.textContent = navLabel();
      }
      updateLegReadout();
    }
    show(el.nav, !!(state.active && next));
    show(el.skip, !!(state.active && next && !isAnchor(next)));
    show(el.note, false);

    show(el.start, !state.active && !done);
    if (el.start) el.start.textContent = nVis > 0 ? "Resume the tour" : "Start the tour";
    show(el.end, state.active && !done);
    if (el.orderBtn) show(el.orderBtn, !done && unvisited().length > 1);

    if (el.order) {
      el.order.innerHTML = state.stands.map(function (s, i) {
        var key = keyOf(s);
        var vis = isVis(s);
        var isNext = next && keyOf(next) === key;
        var cls = (vis ? "is-visited" : "") + (isNext ? " is-next" : "");
        var anchor = isAnchor(s);
        var skipped = isSkipped(s);
        var label = shown(s) + (vis
          ? ". Stamped."
          : skipped
            ? ". Skipped."
            : anchor
              ? ". Stays first."
              : ". Press and hold to move it. Alt and the arrow keys move it.");
        var side = vis
          ? '<span class="ord-stamp">Stamped</span>'
          : skipped
            ? '<span class="ord-stamp">Skipped</span>'
            : "";
        return '<li class="' + cls + (anchor ? " is-anchor" : "") + '" tabindex="0" data-key="' + esc(key) + '" data-visited="' + (vis || skipped ? "1" : "0") + '" data-anchor="' + (anchor ? "1" : "0") + '" aria-label="' + esc(label) + '">' +
          '<span class="ord-num">' + (i + 1) + "</span>" +
          '<span class="ord-text"><span class="ord-name">' + esc(shown(s)) +
            (s.ours ? ' <span class="fsrow-ours">Ours</span>' : "") + "</span>" +
            (s.address ? '<span class="ord-addr">' + esc(s.address) + "</span>" : "") +
          "</span>" + side + "</li>";
      }).join("");
    }

    renderMarkers();
  }

  function bind() {
    if (el.start) el.start.addEventListener("click", startWatch);
    if (el.end) el.end.addEventListener("click", endTour);
    if (el.skip) el.skip.addEventListener("click", skipStop);
    if (el.orderBtn) el.orderBtn.addEventListener("click", function () {
      var panel = document.getElementById("order-panel");
      if (!panel) return;
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        try { panel.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" }); } catch (e) {}
      }
    });
    if (el.celNext) el.celNext.addEventListener("click", closeCelebrate);
    if (el.dialog) el.dialog.addEventListener("close", onCelebrateClosed);

    if (el.order) {
      el.order.addEventListener("click", function (e) {
        if (suppressClick) { suppressClick = false; return; }
        var li = e.target.closest ? e.target.closest("li") : null;
        if (!li || (e.target.closest && e.target.closest("button, a"))) return;
        focusStand(li.getAttribute("data-key"));
      });
      el.order.addEventListener("keydown", function (e) {
        if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
        var li = e.target.closest ? e.target.closest("li") : null;
        if (!li || li.getAttribute("data-visited") === "1") return;
        e.preventDefault();
        var key = li.getAttribute("data-key");
        moveKey(key, e.key === "ArrowUp" ? -1 : 1);
        focusRow(key);
      });
      el.order.addEventListener("pointerdown", onOrderPointerDown);
      el.order.addEventListener("contextmenu", function (e) {
        if (drag) e.preventDefault();
      });
    }

    document.addEventListener("pointermove", onOrderPointerMove);
    document.addEventListener("pointerup", onOrderPointerUp);
    document.addEventListener("pointercancel", onOrderPointerUp);

    document.addEventListener("touchmove", function (e) {
      if (drag && drag.lifted && e.cancelable) e.preventDefault();
    }, { passive: false });

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible" || !state.active || complete()) return;
      requestWake();
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(function (pos) {
        onPos(pos);
        refreshRoute();
      }, function () {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 });
    });
  }

  /* Press-and-hold, then drag. Touch waits ~360ms so a scroll still works.
     A mouse can drag as soon as it moves. The page does not scroll underneath
     a lifted card; we scroll it ourselves when the finger nears the edge. */
  function onOrderPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest && e.target.closest("button, a")) return;
    var row = e.target.closest ? e.target.closest("#tour-order li") : null;
    if (!row || row.getAttribute("data-visited") === "1" || row.getAttribute("data-anchor") === "1") return;
    if (drag && drag.lifted) return;
    var rect = row.getBoundingClientRect();
    drag = {
      pointer: e.pointerId,
      pointerType: e.pointerType || "mouse",
      row: row,
      x: e.clientX,
      y: e.clientY,
      yNow: e.clientY,
      xNow: e.clientX,
      offsetY: e.clientY - rect.top,
      currentDY: 0,
      lifted: false,
      moved: false,
      timer: setTimeout(liftRow, HOLD_MS)
    };
  }

  function dist2(e) {
    var dx = e.clientX - drag.x;
    var dy = e.clientY - drag.y;
    return dx * dx + dy * dy;
  }

  function liftRow() {
    if (!drag || drag.lifted) return;
    if (drag.timer) { clearTimeout(drag.timer); drag.timer = null; }
    drag.lifted = true;
    drag.row.classList.add("is-lifted");
    document.documentElement.classList.add("is-reordering");
    try { drag.row.setPointerCapture(drag.pointer); } catch (err) {}
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (err2) {}
    stickRow();
    autoScrollStart();
  }

  function cancelHold() {
    if (!drag || drag.lifted) return;
    if (drag.timer) clearTimeout(drag.timer);
    drag = null;
  }

  function positions() {
    var rows = el.order.children;
    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) out.push({ el: rows[i], top: rows[i].getBoundingClientRect().top });
    return out;
  }

  function flipRows(prev) {
    if (reduced) return;
    var i;
    for (i = 0; i < prev.length; i++) {
      var node = prev[i].el;
      if (!node || node.classList.contains("is-lifted")) continue;
      var dy = prev[i].top - node.getBoundingClientRect().top;
      if (!dy) continue;
      node.style.transition = "none";
      node.style.transform = "translateY(" + dy + "px)";
      node.getBoundingClientRect();
      node.style.transition = "transform .2s ease";
      node.style.transform = "";
    }
  }

  function renumberRows() {
    if (!el.order) return;
    var rows = el.order.children;
    var seen = false;
    var i;
    for (i = 0; i < rows.length; i++) {
      var num = rows[i].querySelector(".ord-num");
      if (num) num.textContent = String(i + 1);
      var vis = rows[i].getAttribute("data-visited") === "1";
      var isNext = !vis && !seen;
      if (!vis) seen = true;
      rows[i].classList.toggle("is-next", isNext);
    }
  }

  function stickRow() {
    if (!drag || !drag.lifted) return;
    var rect = drag.row.getBoundingClientRect();
    var layoutTop = rect.top - (drag.currentDY || 0);
    var dy = drag.yNow - drag.offsetY - layoutTop;
    drag.currentDY = dy;
    drag.row.style.transform = "translateY(" + dy.toFixed(1) + "px) scale(1.03)";
  }

  function placeRow(x, y) {
    if (!drag || !drag.lifted || !el.order) return;
    drag.xNow = x;
    drag.yNow = y;
    var rows = el.order.children;
    var spots = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      if (rows[i] === drag.row) continue;
      if (rows[i].getAttribute("data-visited") === "1") continue;
      if (rows[i].getAttribute("data-anchor") === "1") continue;
      var r = rows[i].getBoundingClientRect();
      spots.push({ el: rows[i], mid: r.top + r.height / 2 });
    }
    var target = null;
    var after = false;
    for (i = 0; i < spots.length; i++) {
      if (y < spots[i].mid) { target = spots[i].el; break; }
    }
    if (!target && spots.length) {
      target = spots[spots.length - 1].el;
      after = true;
    }
    if (target) {
      var parent = drag.row.parentNode;
      var before = orderSig();
      var prev = positions();
      parent.insertBefore(drag.row, after ? target.nextSibling : target);
      if (orderSig() !== before) {
        renumberRows();
        flipRows(prev);
        drag.moved = true;
      }
    }
    stickRow();
  }

  function orderSig() {
    var rows = el.order.children;
    var s = "";
    var i;
    for (i = 0; i < rows.length; i++) s += rows[i].getAttribute("data-key") + "\n";
    return s;
  }

  function scroller() {
    var sheet = document.getElementById("tour-sheet");
    if (sheet && sheet.scrollHeight > sheet.clientHeight + 8) return sheet;
    return window;
  }

  function autoScrollStart() {
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    function frame() {
      if (!drag || !drag.lifted) { scrollRaf = 0; return; }
      var y = drag.yNow;
      var margin = 72;
      var maxStep = 16;
      var dy = 0;
      if (y < margin) dy = -Math.max(2, Math.ceil((margin - y) / margin * maxStep));
      else if (y > window.innerHeight - margin) dy = Math.max(2, Math.ceil((y - (window.innerHeight - margin)) / margin * maxStep));
      if (dy) {
        var box = scroller();
        if (box === window) window.scrollBy(0, dy);
        else box.scrollTop += dy;
        placeRow(drag.xNow, drag.yNow);
      }
      scrollRaf = requestAnimationFrame(frame);
    }
    scrollRaf = requestAnimationFrame(frame);
  }

  function onOrderPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointer) return;
    if (!drag.lifted) {
      if (drag.pointerType === "mouse") {
        if (dist2(e) > 25) liftRow();
      } else if (dist2(e) > 144) {
        cancelHold();
        return;
      }
      if (!drag || !drag.lifted) return;
    }
    if (e.cancelable) e.preventDefault();
    placeRow(e.clientX, e.clientY);
  }

  function finishDrag() {
    if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = 0; }
    document.documentElement.classList.remove("is-reordering");
    var info = drag;
    drag = null;
    if (!info) return;
    if (info.timer) clearTimeout(info.timer);
    var row = info.row;
    if (!info.lifted) return;
    suppressClick = true;
    row.style.transition = "transform .22s ease, box-shadow .22s ease";
    row.style.transform = "";
    row.classList.remove("is-lifted");
    setTimeout(function () {
      if (row && row.style) row.style.transition = "";
      if (info.moved) commitDomOrder();
      suppressClick = false;
    }, info.moved ? 230 : 0);
  }

  function onOrderPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointer) return;
    finishDrag();
  }

  function focusRow(key) {
    if (!el.order) return;
    var rows = el.order.querySelectorAll("li");
    var i;
    for (i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute("data-key") === key) { rows[i].focus(); return; }
    }
  }

  function maybeAutoResume() {
    if (!state.active || complete()) return;
    if (!navigator.permissions || !navigator.permissions.query) return;
    navigator.permissions.query({ name: "geolocation" }).then(function (p) {
      if (p.state === "granted" && state.active && state.watchId == null) startWatch();
    }).catch(function () {});
  }

  function boot(pack) {
    state.placeholder = pack.placeholder;
    state.missing = pack.missing || [];
    state.original = (pack.route || pack.matched).slice();
    var saved = CrawlLogic.reconcile(loadSaved(), state.original);
    state.stands = saved.order;
    state.visited = saved.visited;
    state.skipped = {};
    var raw = loadSaved();
    ((raw && raw.skipped) || []).forEach(function (k) { state.skipped[String(k)] = true; });
    state.active = !!(saved.started && !complete());
    if (!state.placeholder) {
      Array.prototype.forEach.call(document.querySelectorAll("[data-ph]"), function (node) {
        if (node.parentNode) node.parentNode.removeChild(node);
      });
    }
    if (el.missing && state.missing.length) {
      el.missing.hidden = false;
      el.missing.textContent = "Not on the map yet: " +
        state.missing.map(function (m) { return m && m.name ? m.name : String(m); }).join(", ") + ".";
    }
    normalize();
    if (state.active && complete()) state.active = false;
    initMap();
    bind();
    render();
    refreshRoute();
    openHash();
    maybeAutoResume();
    /* ?start=1 comes from the big button. Begin at once so they are not
       asked to tap Start a second time. */
    if (/[?&]start=1(?:&|$)/.test(location.search)) {
      if (!complete()) {
        if (visitedCount() === 0) state.stands = state.original.slice();
        startWatch();
      }
      try { history.replaceState(null, "", location.pathname + location.hash); } catch (e) { /* keep the query */ }
    }
  }

  function fail() {
    grab();
    if (el.progress) el.progress.textContent = "";
    if (el.idle) el.idle.textContent = "Refresh the page.";
  }

  grab();
  if (el.progress) el.progress.textContent = "Loading…";
  CrawlData.loadCrawl().then(function (pack) {
    var base = CrawlLogic.previewBase();
    if (!base && !(pack && pack.showStands)) {
      location.replace("/crawl2026");
      return;
    }
    if (base) {
      Array.prototype.forEach.call(document.querySelectorAll('a[href="/crawl2026"], a[href="/crawl2026/"]'), function (a) {
        a.setAttribute("href", base + "/");
      });
    }
    boot(pack);
  }).catch(fail);
})();
