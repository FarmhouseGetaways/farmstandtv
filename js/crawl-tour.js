/* Live tour for /crawl2026/map.
 *
 * Who appears: data/crawl2026.json (see js/crawl-data.js). This file does
 * not keep its own stand list.
 *
 * The drive line comes from the public OSRM demo
 * (https://router.project-osrm.org). If that request fails, the line is
 * straight and the page says so. Navigate still opens Google Maps or
 * Apple Maps for the current leg — that handoff is the reliable one.
 *
 * Order and stamps are kept in localStorage under fstv-crawl-2026-v1 on
 * this phone only. Nothing is sent to a server.
 */
(function () {
  if (!window.CrawlLogic || !window.CrawlData) return;

  var KEY = "fstv-crawl-2026-v1";
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
    active: false,
    picking: false,
    picked: [],
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
  var routeToken = 0;
  var fittedKey = "";
  var lastFit = null;
  var tileLayer = null;
  var drag = null;
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
    return isAppleMobile() ? "Navigate in Apple Maps" : "Navigate in Google Maps";
  }

  function keyOf(s) { return CrawlLogic.standKey(s); }
  function isVis(s) { return !!state.visited[keyOf(s)]; }

  function visitedCount() {
    var n = 0;
    state.stands.forEach(function (s) { if (isVis(s)) n++; });
    return n;
  }

  function complete() {
    return state.stands.length > 0 && visitedCount() === state.stands.length;
  }

  function nextStop() {
    var i;
    for (i = 0; i < state.stands.length; i++) if (!isVis(state.stands[i])) return state.stands[i];
    return null;
  }

  function unvisited() {
    return state.stands.filter(function (s) { return !isVis(s); });
  }

  function normalize() {
    var vis = [];
    var rest = [];
    state.stands.forEach(function (s) { (isVis(s) ? vis : rest).push(s); });
    state.stands = vis.concat(rest);
  }

  function setStatus(msg) {
    if (el.status) el.status.textContent = msg || "";
  }

  function loadSaved() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || o.v !== 1) return null;
      return o;
    } catch (e) { return null; }
  }

  function save() {
    var order = state.stands.map(keyOf);
    var visited = [];
    state.stands.forEach(function (s) { if (isVis(s)) visited.push(keyOf(s)); });
    try {
      localStorage.setItem(KEY, JSON.stringify({
        v: 1, order: order, visited: visited, started: !!state.active
      }));
    } catch (e) { /* private mode, full disk — the tour still runs */ }
  }

  function grab() {
    ["tour-progress", "tour-status", "tour-leg", "leg-kicker", "leg-name", "leg-meta",
     "leg-addr", "leg-hours", "leg-note", "leg-nav", "leg-stamp", "leg-skip",
     "btn-start", "btn-end", "btn-suggest", "btn-pick", "btn-reset", "btn-recenter",
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
        el.map.innerHTML = '<p class="fsfail">The map did not load. The list below still works, and Navigate opens the maps app.</p>';
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
    var label = kind === "visited" ? "\u2713" : String(n);
    return L.divIcon({
      className: "pin-wrap",
      html: '<span class="pin pin-' + kind + '">' + label + "</span>",
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });
  }

  function youIcon() {
    var arrow = "";
    if (state.heading != null && isFinite(state.heading)) {
      arrow = '<i style="transform:rotate(' + state.heading.toFixed(1) + 'deg)"></i>';
    }
    return L.divIcon({
      className: "you-wrap",
      html: '<span class="you">' + arrow + "<b></b></span>",
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
  }

  function popupHtml(s) {
    var bits = ['<div class="pop"><h3>' + esc(s.name) + "</h3>"];
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
      var marker = L.marker([s.lat, s.lng], { icon: pinIcon(i + 1, kind), title: s.name, zIndexOffset: kind === "next" ? 400 : 0 })
        .bindPopup(popupHtml(s))
        .addTo(state.markers);
      s._marker = marker;
    });
  }

  function drawUser() {
    if (!state.map || !state.user) return;
    var ll = [state.user.lat, state.user.lng];
    if (!state.you) {
      state.you = L.marker(ll, { icon: youIcon(), pane: "you", zIndexOffset: 800, title: "You are here" }).addTo(state.map);
    } else {
      state.you.setLatLng(ll);
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

  function clearRoute() {
    routeLayers.forEach(function (layer) {
      if (state.map) state.map.removeLayer(layer);
    });
    routeLayers = [];
  }

  function addLine(coords, style) {
    if (!state.map || !coords || coords.length < 2) return;
    style.pane = "routes";
    routeLayers.push(L.polyline(coords, style).addTo(state.map));
  }

  function drawRoute(coords, restPts) {
    clearRoute();
    if (restPts && restPts.length >= 2) {
      addLine(restPts, {
        color: "#8E2432", weight: 3, opacity: .4, dashArray: "7 9",
        lineCap: "round", lineJoin: "round"
      });
    }
    addLine(coords, { color: "#5C3A16", weight: 8, opacity: .4, lineCap: "round", lineJoin: "round" });
    addLine(coords, { color: "#C8962E", weight: 5, opacity: .95, lineCap: "round", lineJoin: "round" });
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

  function refreshRoute() {
    var token = ++routeToken;
    var next = nextStop();
    var upcoming = unvisited().filter(CrawlLogic.located);

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
      var rest = upcoming.map(function (s) { return [s.lat, s.lng]; });
      drawRoute(bee, rest);
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
        drawRoute(r.coords, rest);
        updateLegReadout();
        show(el.note, false);
        fitIfNew(r.coords, keyOf(next) + ":road");
      }).catch(function () {
        if (token !== routeToken) return;
        show(el.note, true);
      });
      return;
    }

    state.legRoute = null;
    state.routeIsStraight = false;
    show(el.note, false);
    var pts = state.stands.filter(CrawlLogic.located);
    if (pts.length < 2) { clearRoute(); return; }
    var overview = pts.map(function (s) { return [s.lat, s.lng]; });
    drawRoute(overview, null);
    if (!state.active) fitIfNew(overview, "all");
    osrm(pts).then(function (r) {
      if (token !== routeToken) return;
      drawRoute(r.coords, null);
      if (!state.active) fitIfNew(r.coords, "all-road");
    }).catch(function () { /* the straight line is already down */ });
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
          fromOsrm: true
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
    if (el.status && /Looking for this phone|dropped out|Still no location/.test(el.status.textContent || "")) setStatus("");
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
      setStatus("Location is blocked. You can stamp a stop by hand, and Navigate opens the maps app.");
      return;
    }
    if (!state.user) {
      setStatus("No location yet. Still trying. Navigate opens the maps app for this leg.");
    }
  }

  function armWait() {
    if (state.waitTimer) clearTimeout(state.waitTimer);
    state.waitTimer = setTimeout(function () {
      if (state.active && !state.user) {
        setStatus("Still no location. You can stamp a stop by hand, or use Navigate.");
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
    state.picking = false;
    save();
    requestWake();
    render();
    if (!navigator.geolocation) {
      setStatus("This browser has no location service. You can stamp a stop by hand, and Navigate opens the maps app.");
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
      setStatus("Looking for this phone…");
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
    setStatus("Tour paused. Stamps stay on this phone.");
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
      el.meta.textContent = state.active ? "Waiting on a location for the distance." : "Distance shows once the tour has a location.";
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
    if (el.celName) el.celName.textContent = stand.name;
    if (el.celDetail) {
      el.celDetail.textContent = nxt
        ? "Next is " + nxt.name + "."
        : "That was the last stop on this list.";
    }
    if (el.celNext) el.celNext.textContent = nxt ? "On to the next stand" : "That's the last one";
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
      setStatus("Every stand on this list is stamped on this phone.");
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

  function applySuggestion(origin) {
    normalize();
    var vis = state.stands.filter(isVis);
    var rest = state.stands.filter(function (s) { return !isVis(s); });
    state.stands = vis.concat(origin ? CrawlLogic.optimizeOrder(origin, rest) : rest);
    state.picking = false;
    state.picked = [];
    save();
    render();
    refreshRoute();
  }

  function applyPicked() {
    normalize();
    var vis = state.stands.filter(isVis);
    var rest = state.stands.filter(function (s) { return !isVis(s); });
    var by = {};
    rest.forEach(function (s) { by[keyOf(s)] = s; });
    var ordered = [];
    state.picked.forEach(function (k) {
      if (by[k]) { ordered.push(by[k]); delete by[k]; }
    });
    rest.forEach(function (s) { if (by[keyOf(s)]) ordered.push(s); });
    state.stands = vis.concat(ordered);
  }

  function moveKey(key, dir) {
    var i = -1;
    var n;
    for (n = 0; n < state.stands.length; n++) if (keyOf(state.stands[n]) === key) i = n;
    if (i < 0) return;
    var j = i + dir;
    if (j < 0 || j >= state.stands.length) return;
    if (isVis(state.stands[i]) || isVis(state.stands[j])) return;
    var tmp = state.stands[i];
    state.stands[i] = state.stands[j];
    state.stands[j] = tmp;
    save();
    render();
    refreshRoute();
  }

  function togglePick(key) {
    if (state.visited[key]) return;
    var i = state.picked.indexOf(key);
    if (i >= 0) state.picked.splice(i, 1);
    else state.picked.push(key);
    applyPicked();
    save();
    render();
    refreshRoute();
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
    setStatus("Looking for this phone…");
    navigator.geolocation.getCurrentPosition(function (pos) {
      onPos(pos);
      setStatus("");
      cb(state.user);
    }, function () {
      setStatus("No location yet, so the list stays in the saved order.");
      cb(null);
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 });
  }

  function startOver() {
    if (!window.confirm("Clear the stamps and the order saved on this phone?")) return;
    stopWatch();
    state.active = false;
    state.visited = {};
    state.stands = state.original.slice();
    state.picking = false;
    state.picked = [];
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

    if (el.progress) {
      el.progress.textContent = state.stands.length
        ? (nVis + " of " + state.stands.length + " stamped")
        : "No stands on the list";
    }

    if (el.idle) {
      if (!state.stands.length) {
        el.idle.textContent = "No stands matched the crawl list. The list is data/crawl2026.json.";
        show(el.idle, true);
      } else if (done) {
        el.idle.textContent = "Every stand on this list is stamped on this phone. Start over clears them.";
        show(el.idle, true);
      } else if (!state.active) {
        el.idle.textContent = "These are the only pins. Start the tour and this phone shows where you are. Take the suggested order from where you are, or set your own before you go.";
        show(el.idle, true);
      } else {
        show(el.idle, false);
      }
    }

    show(el.leg, !!next);
    if (next && el.name) {
      el.kicker.textContent = (!state.active && nVis === 0) ? "First on the list" : "Next stop";
      el.name.textContent = next.name;
      el.addr.textContent = next.address || "";
      el.hours.textContent = next.hours || "";
      show(el.hours, !!next.hours);
      if (el.nav) {
        el.nav.href = directionsURL(next);
        el.nav.textContent = navLabel();
      }
      updateLegReadout();
    }
    show(el.stamp, !!(state.active && next && !done));
    show(el.skip, !!(state.active && unvisited().length > 1));
    show(el.note, !!(state.active && state.routeIsStraight && state.user && next));

    show(el.start, !state.active && !done);
    if (el.start) el.start.textContent = nVis > 0 ? "Resume tour" : "Start tour";
    show(el.end, state.active && !done);
    show(el.suggest, !done && state.stands.length > 1);
    show(el.pick, !done && unvisited().length > 1);
    if (el.pick) {
      el.pick.textContent = state.picking ? "Done setting order" : "Set my own order";
      el.pick.setAttribute("aria-pressed", state.picking ? "true" : "false");
    }
    show(el.help, state.picking);
    show(el.recenter, !!state.map);

    if (el.order) {
      el.order.classList.toggle("is-picking", state.picking);
      var visSoFar = nVis;
      el.order.innerHTML = state.stands.map(function (s, i) {
        var key = keyOf(s);
        var vis = isVis(s);
        var isNext = next && keyOf(next) === key;
        var canNudge = !vis && !state.picking;
        var cls = (vis ? "is-visited" : "") + (isNext ? " is-next" : "");
        var handle = canNudge
          ? '<button type="button" class="drag-handle" data-drag aria-label="Drag to reorder ' + esc(s.name) + '"></button>'
          : "";
        var side;
        if (vis) side = '<span class="ord-stamp">Stamped</span>';
        else if (state.picking) side = "";
        else {
          side = '<span class="ord-actions">' +
            '<button type="button" class="nudge" data-up ' + (i <= visSoFar ? "disabled" : "") +
              ' aria-label="Move ' + esc(s.name) + ' up">Up</button>' +
            '<button type="button" class="nudge" data-down ' + (i >= state.stands.length - 1 ? "disabled" : "") +
              ' aria-label="Move ' + esc(s.name) + ' down">Down</button></span>';
        }
        return '<li class="' + cls + '" data-key="' + esc(key) + '" data-visited="' + (vis ? "1" : "0") + '">' +
          handle +
          '<span class="ord-num">' + (i + 1) + "</span>" +
          '<span class="ord-text"><span class="ord-name">' + esc(s.name) +
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
    if (el.stamp) el.stamp.addEventListener("click", function () {
      var next = nextStop();
      if (next) stamp(next);
    });
    if (el.skip) el.skip.addEventListener("click", function () {
      var rest = unvisited();
      if (rest.length < 2) return;
      var moved = rest[0];
      state.stands = state.stands.filter(function (s) { return s !== moved; });
      state.stands.push(moved);
      normalize();
      save();
      render();
      refreshRoute();
    });
    if (el.suggest) el.suggest.addEventListener("click", function () {
      ensureFix(function (origin) {
        if (!origin) return;
        applySuggestion(origin);
        setStatus("Order is the short drive from where you are. You can still change it.");
      });
    });
    if (el.pick) el.pick.addEventListener("click", function () {
      state.picking = !state.picking;
      if (state.picking) state.picked = [];
      render();
    });
    if (el.reset) el.reset.addEventListener("click", startOver);
    if (el.recenter) el.recenter.addEventListener("click", recenter);
    if (el.celNext) el.celNext.addEventListener("click", closeCelebrate);
    if (el.dialog) el.dialog.addEventListener("close", onCelebrateClosed);

    if (el.order) {
      el.order.addEventListener("click", function (e) {
        if (suppressClick) { suppressClick = false; return; }
        var li = e.target.closest ? e.target.closest("li") : null;
        if (!li) return;
        var key = li.getAttribute("data-key");
        if (e.target.closest("[data-up]")) { moveKey(key, -1); return; }
        if (e.target.closest("[data-down]")) { moveKey(key, 1); return; }
        if (e.target.closest("[data-drag], button, a")) return;
        if (state.picking) { togglePick(key); return; }
        focusStand(key);
      });
      el.order.addEventListener("pointerdown", function (e) {
        var handle = e.target.closest ? e.target.closest("[data-drag]") : null;
        if (!handle || state.picking) return;
        var row = handle.closest("li");
        if (!row || row.getAttribute("data-visited") === "1") return;
        drag = { pointer: e.pointerId, row: row, moved: false };
        row.setPointerCapture(e.pointerId);
        row.classList.add("is-dragging");
      });
      el.order.addEventListener("pointermove", function (e) {
        if (!drag || e.pointerId !== drag.pointer) return;
        drag.moved = true;
        var stack = document.elementsFromPoint ? document.elementsFromPoint(e.clientX, e.clientY) : [];
        var over = null;
        var i;
        for (i = 0; i < stack.length; i++) {
          var li = stack[i].closest ? stack[i].closest("#tour-order li") : null;
          if (li && li !== drag.row && li.getAttribute("data-visited") !== "1") { over = li; break; }
        }
        if (!over) return;
        var rect = over.getBoundingClientRect();
        var after = e.clientY > rect.top + rect.height / 2;
        if (after) over.parentNode.insertBefore(drag.row, over.nextSibling);
        else over.parentNode.insertBefore(drag.row, over);
      });
      function endDrag(e) {
        if (!drag || e.pointerId !== drag.pointer) return;
        drag.row.classList.remove("is-dragging");
        var moved = drag.moved;
        drag = null;
        if (moved) {
          suppressClick = true;
          commitDomOrder();
          setTimeout(function () { suppressClick = false; }, 400);
        }
      }
      el.order.addEventListener("pointerup", endDrag);
      el.order.addEventListener("pointercancel", endDrag);
    }

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && state.active && !complete()) requestWake();
    });
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
    state.original = pack.matched.slice();
    var saved = CrawlLogic.reconcile(loadSaved(), pack.matched);
    state.stands = saved.order;
    state.visited = saved.visited;
    state.active = !!(saved.started && !complete());
    if (!state.placeholder) {
      Array.prototype.forEach.call(document.querySelectorAll("[data-ph]"), function (node) {
        if (node.parentNode) node.parentNode.removeChild(node);
      });
    }
    if (el.missing && state.missing.length) {
      el.missing.hidden = false;
      el.missing.textContent = "Not on the map, so left off the tour: " + state.missing.join(", ") +
        ". Check the spelling in data/crawl2026.json.";
    }
    normalize();
    if (state.active && complete()) state.active = false;
    initMap();
    bind();
    render();
    refreshRoute();
    openHash();
    maybeAutoResume();
    /* ?start=1 comes from the landing button. Focus the control without
       scrolling the map off the screen — the button already sits under it. */
    if (el.start && /[?&]start=1(?:&|$)/.test(location.search)) {
      try { el.start.focus({ preventScroll: true }); } catch (e) { /* older browsers */ }
    }
  }

  function fail() {
    grab();
    if (el.progress) el.progress.textContent = "The crawl list did not load.";
    if (el.idle) el.idle.textContent = "Refresh the page. The full map is still at /maps.";
  }

  grab();
  if (el.progress) el.progress.textContent = "Loading the stands…";
  CrawlData.loadCrawl().then(boot).catch(fail);
})();
