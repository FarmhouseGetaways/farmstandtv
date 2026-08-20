/* ==========================================================================
   The Ramona Farmstand Map — our own, on our own site.

   Why this exists rather than a Google My Maps embed: My Maps has no API and
   no automatic sync, so a stand you approve does not appear until somebody
   opens My Maps and reimports a layer by hand. Reading the sheet directly
   removes that step entirely — approve a row, refresh, the pin is there.

   DATA
   Set SHEET_CSV below to a published Google Sheet and it becomes the source of
   truth. Until then the map falls back to /data/stands.json.

   To publish the sheet:  File -> Share -> Publish to web -> pick the ForMap
   tab -> Comma-separated values (.csv) -> Publish. Paste that URL below.

   Expected columns (header row, any order, case-insensitive):
       name | address | lat | lng | hours | sells | phone | email | url
   lat/lng are optional. A stand without them still appears in the list with a
   working Directions link; it just has no pin.
   ========================================================================== */

var SHEET_CSV = "";                      // <- paste the published CSV URL here
var FALLBACK  = "/data/stands.json";
var LANDMARKS = "/data/landmarks.json";
var ROADS     = "/data/roads.json";

var CENTER = [33.0300, -116.8700];
var ZOOM   = 12;

/* Basemaps. All free, all keyless, all requiring the attribution shown.
   The switcher on the page lets you compare them live — once you have picked
   one, set DEFAULT_STYLE to it and delete the rest if you want the control
   gone. Past a few thousand views a month, move to a keyed provider. */
var OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
var STYLES = {
  streets: {
    label: "Streets",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attrib: OSM_ATTR, max: 19,
    // the busiest and most colourful: green landuse, amber roads, every POI named
  },
  terrain: {
    label: "Terrain",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    attrib: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, USGS, NOAA', max: 19,
    // hill shading and green open space — reads like a paper trail map
  },
  clean: {
    label: "Clean",
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attrib: OSM_ATTR + ' &copy; <a href="https://carto.com/attributions">CARTO</a>',
    max: 20, sub: "abcd",
    // quiet and typographic — what the site shipped with
  },
  satellite: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attrib: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics', max: 19,
    // you can actually see the groves and the barns
  }
};
var DEFAULT_STYLE = "streets";

var TAG_LABELS = {
  produce:  "Produce",
  eggs:     "Eggs",
  bakery:   "Bakery",
  honey:    "Honey",
  flowers:  "Flowers",
  prepared: "Prepared food",
  goods:    "Goods"
};

/* Little glyphs for the landmark layer. Drawn inline so there are no extra
   requests and they take the map's colours. */
var GLYPH = {
  peak:     '<path d="M2 17 L8 6 L12 12 L15 8 L20 17 Z"/>',
  park:     '<path d="M11 20v-4M11 16 L5 16 L11 3 L17 16 Z"/>',
  water:    '<path d="M11 3 C 6 10, 4 13, 4 15 a7 7 0 0 0 14 0 c0-2-2-5-7-12z"/>',
  museum:   '<path d="M2 9 L11 3 L20 9 Z M4 10v8M8.5 10v8M13.5 10v8M18 10v8M2 19h18"/>',
  castle:   '<path d="M3 20V7l3 2 2.5-3 2.5 3 2.5-3 2.5 3 3-2v13z"/>',
  wildlife: '<path d="M11 20c-4 0-6-2-6-4 0-3 2-5 6-5s6 2 6 5c0 2-2 4-6 4z M5 6.5a2 2 0 1 1 0 .01 M17 6.5a2 2 0 1 1 0 .01"/>',
  air:      '<path d="M2 12 L20 5 L16 12 L20 19 Z"/>',
  sign:     '<path d="M11 21V10M4 4h11l3 3-3 3H4z"/>',
  place:    '<circle cx="11" cy="11" r="5"/>'
};

function landmarkIcon(kind) {
  var g = GLYPH[kind] || GLYPH.place;
  return L.divIcon({
    className: "lmark",
    html: '<span class="lmark-dot"><svg viewBox="0 0 22 22" aria-hidden="true">' + g + "</svg></span>",
    iconSize: [26, 26], iconAnchor: [13, 13]
  });
}

/* ------------------------------------------------------------------ utils */

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* A CSV parser that copes with quoted fields containing commas and newlines,
   because addresses contain commas and someone will eventually paste one with
   a line break in it. */
function parseCSV(text) {
  var rows = [], row = [], val = "", q = false, i = 0;
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (; i < text.length; i++) {
    var c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { val += '"'; i++; }
      else if (c === '"') { q = false; }
      else { val += c; }
    } else if (c === '"') { q = true; }
    else if (c === ",") { row.push(val); val = ""; }
    else if (c === "\n") { row.push(val); rows.push(row); row = []; val = ""; }
    else { val += c; }
  }
  if (val.length || row.length) { row.push(val); rows.push(row); }
  return rows.filter(function (r) { return r.some(function (c) { return c.trim(); }); });
}

function rowsToStands(rows) {
  if (!rows.length) return [];
  var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
  var idx = function (n) { return head.indexOf(n); };
  var col = { name: idx("name"), address: idx("address"), lat: idx("lat"),
              lng: idx("lng"), hours: idx("hours"), sells: idx("sells"),
              phone: idx("phone"), email: idx("email"), url: idx("url") };
  // tolerate the alternative spellings people actually use
  if (col.lng < 0) col.lng = idx("long");
  if (col.lng < 0) col.lng = idx("longitude");
  if (col.lat < 0) col.lat = idx("latitude");

  return rows.slice(1).map(function (r) {
    var get = function (k) { return col[k] >= 0 ? (r[col[k]] || "").trim() : ""; };
    var lat = parseFloat(get("lat")), lng = parseFloat(get("lng"));
    return {
      name: get("name"), address: get("address"),
      lat: isFinite(lat) ? lat : null, lng: isFinite(lng) ? lng : null,
      hours: get("hours"), sells: get("sells"),
      phone: get("phone"), email: get("email"), url: get("url"),
      tags: []
    };
  }).filter(function (s) { return s.name; });
}

/* Longitude out here is negative. A positive one is a missing minus sign, and
   the pin would land in China — which is exactly the mistake sitting in the
   Drive sheet against Early Light Farms today. Fix it rather than plot it. */
function sane(s) {
  if (s.lat == null || s.lng == null) return s;
  if (s.lng > 0 && s.lat > 20 && s.lat < 50) s.lng = -s.lng;
  if (s.lat < 32 || s.lat > 34.5 || s.lng < -118.5 || s.lng > -115.5) {
    s.outOfRange = true;                  // listed, but not plotted
  }
  return s;
}

/* An iPhone should open Apple Maps, not Google. iPadOS has reported itself as
   "Macintosh" since iPadOS 13, so the touch check is what catches an iPad.
   Desktop Macs stay on Google — maps.apple.com in a non-Safari browser is a
   worse experience than the thing that just works. */
function isAppleMobile() {
  var ua = navigator.userAgent || "";
  if (/iPhone|iPod/.test(ua)) return true;
  return /iPad/.test(ua) ||
         (/Macintosh/.test(ua) && typeof document !== "undefined" &&
          "ontouchend" in document);
}

function directionsURL(s) {
  var q = s.lat != null && !s.outOfRange
        ? s.lat + "," + s.lng
        : s.address;
  return isAppleMobile()
    ? "https://maps.apple.com/?daddr=" + encodeURIComponent(q) + "&dirflg=d"
    : "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(q);
}

/* ------------------------------------------------------------------- boot */

function boot(stands) {
  stands = stands.map(sane);
  // Ours goes first however the data arrived — the JSON is already sorted, a
  // sheet will not be.
  stands.sort(function (a, b) {
    if (!!a.ours !== !!b.ours) return a.ours ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  var showLabels = false;   // stand names: hover-only until the button says otherwise

  /* The list works with or without Leaflet. If the map library fails to load —
     a blocked CDN, a bad network — the page still gives every stand with its
     address and a working Directions link, which is most of the value. Only
     the pins are lost. */
  var hasMap = (typeof L !== "undefined");
  var map = null, group = null, icon = null;

  if (hasMap) {
    map = L.map("fsmap", { scrollWheelZoom: false, attributionControl: true })
            .setView(CENTER, ZOOM);

    var tileLayer = null;
    function setStyle(key) {
      var st = STYLES[key] || STYLES[DEFAULT_STYLE];
      if (tileLayer) map.removeLayer(tileLayer);
      tileLayer = L.tileLayer(st.url, {
        attribution: st.attrib, maxZoom: st.max || 19,
        subdomains: st.sub || "abc"
      }).addTo(map);
      document.getElementById("fsmap").classList.toggle("on-satellite", key === "satellite");
      var box = document.getElementById("fsstyles");
      if (box) Array.prototype.forEach.call(box.children, function (b) {
        b.classList.toggle("is-on", b.dataset.style === key);
      });
    }

    var styleBox = document.getElementById("fsstyles");
    if (styleBox) {
      styleBox.innerHTML = Object.keys(STYLES).map(function (k) {
        return '<button class="fschip fschip-sm" data-style="' + k + '">' +
               STYLES[k].label + "</button>";
      }).join("");
      styleBox.addEventListener("click", function (e) {
        var b = e.target.closest(".fschip"); if (b) setStyle(b.dataset.style);
      });
    }
    setStyle(DEFAULT_STYLE);
    map.on("click", function () { map.scrollWheelZoom.enable(); });
    map.on("mouseout", function () { map.scrollWheelZoom.disable(); });
    /* Smaller than they were. At 36px the pins piled on top of each other
       around the town centre and you could not tell how many there were. */
    icon = L.icon({
      iconUrl: "/images/pin.png", iconRetinaUrl: "/images/pin@2x.png",
      iconSize: [26, 35], iconAnchor: [13, 34], popupAnchor: [0, -30]
    });
    /* Cory's own routes between the stands, in the amber he styled them.
       A dark casing underneath so the line reads on light ground. Drawn into
       a pane below the markers so pins are always clickable. */
    map.createPane("roads");
    map.getPane("roads").style.zIndex = 380;
    fetch(ROADS).then(function (r) { return r.json(); }).then(function (d) {
      (d.lines || []).forEach(function (line) {
        L.polyline(line, { pane: "roads", color: "#8A6B00", weight: 9,
                           opacity: .35, lineCap: "round", lineJoin: "round" }).addTo(map);
        L.polyline(line, { pane: "roads", color: d.color || "#FFD600", weight: 5,
                           opacity: .95, lineCap: "round", lineJoin: "round" }).addTo(map);
      });
    }).catch(function () { /* the roads are a flourish; never block the map */ });

    group = L.layerGroup().addTo(map);

    /* Stand names are hover-only by default — thirty permanent labels is a wall
       of boxes, not a map. The button turns them all on for anyone who wants to
       read the whole plateau at once. */
    var lblBtn = document.getElementById("fslabels");
    if (lblBtn) {
      lblBtn.hidden = false;
      lblBtn.addEventListener("click", function () {
        showLabels = !showLabels;
        lblBtn.classList.toggle("is-on", showLabels);
        lblBtn.textContent = showLabels ? "Hide names" : "Show all names";
        render();
      });
    }

    /* The landmarks layer — the scenery on the printed map. Off by default so
       the stands are not competing with it, and toggled by a chip. */
    var marks = L.layerGroup();
    fetch(LANDMARKS).then(function (r) { return r.json(); }).then(function (d) {
      (d.landmarks || []).forEach(function (p) {
        L.marker([p.lat, p.lng], { icon: landmarkIcon(p.kind), title: p.name })
         .bindTooltip(p.name, { permanent: true, direction: "right",
                                offset: [12, 0], className: "map-label map-label-lm" })
         .bindPopup('<div class="pop"><h3>' + esc(p.name) + "</h3>" +
                    '<p class="pop-links"><a href="https://www.google.com/maps/dir/?api=1&destination=' +
                    encodeURIComponent(p.lat + "," + p.lng) +
                    '" target="_blank" rel="noopener">Directions</a></p></div>')
         .addTo(marks);
      });
      var btn = document.getElementById("fslandmarks");
      if (btn) {
        btn.hidden = false;
        btn.addEventListener("click", function () {
          var on = map.hasLayer(marks);
          if (on) { map.removeLayer(marks); } else { marks.addTo(map); }
          btn.classList.toggle("is-on", !on);
        });
      }
    }).catch(function () { /* landmarks are a bonus; never block the map */ });
  } else {
    var holder = document.getElementById("fsmap");
    if (holder) {
      holder.className = "fsmap-off";
      holder.innerHTML = '<p class="fsfail">The interactive map did not load. ' +
        'Every stand is listed below with directions.</p>';
    }
  }

  var listEl = document.getElementById("fslist");
  var countEl = document.getElementById("fscount");
  var active = "all";

  function popup(s) {
    var bits = ['<div class="pop"><h3>' + esc(s.name) + "</h3>"];
    if (s.sells)   bits.push('<p class="pop-sells">' + esc(s.sells) + "</p>");
    if (s.hours)   bits.push('<p class="pop-hours">' + esc(s.hours) + "</p>");
    if (s.address) bits.push('<p class="pop-addr">' + esc(s.address) + "</p>");
    bits.push('<p class="pop-links"><a href="' + esc(directionsURL(s)) +
              '" target="_blank" rel="noopener">Directions</a>');
    if (s.url) {
      var u = s.url.indexOf("http") === 0 ? s.url : "https://" + s.url;
      bits.push('<a href="' + esc(u) + '" target="_blank" rel="noopener">Website</a>');
    }
    if (s.phone) bits.push('<a href="tel:' + esc(s.phone.replace(/[^0-9+]/g, "")) + '">Call</a>');
    bits.push("</p></div>");
    return bits.join("");
  }

  function matches(s) {
    return active === "all" || (s.tags || []).indexOf(active) > -1;
  }

  function render() {
    if (group) group.clearLayers();
    var shown = stands.filter(matches);
    var plotted = 0;

    shown.forEach(function (s) {
      if (s.lat == null || s.outOfRange) return;
      plotted++;
      if (!hasMap) return;
      s._marker = L.marker([s.lat, s.lng], { icon: icon, title: s.name })
                   .bindPopup(popup(s))
                   .bindTooltip(s.name, { permanent: showLabels, direction: "right",
                                          offset: [14, -6], className: "map-label" })
                   .addTo(group);
    });

    countEl.textContent = shown.length + (shown.length === 1 ? " stand" : " stands") +
      (plotted < shown.length ? " · " + plotted + " with pins so far" : "");

    /* Frame whatever is actually showing rather than trusting a fixed zoom —
       otherwise one outlying stand leaves the rest in a heap in the middle. */
    if (hasMap && plotted) {
      var pts = shown.filter(function (s) { return s.lat != null && !s.outOfRange; })
                     .map(function (s) { return [s.lat, s.lng]; });
      map.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 14 });
    }

    listEl.innerHTML = shown.map(function (s, i) {
      return '<li class="fsrow" data-i="' + i + '">' +
        '<div><b>' + esc(s.name) +
        (s.ours ? '<span class="fsrow-ours">Ours</span>' : "") + "</b>" +
        // hours first — it is what decides whether the drive is worth it today
        (s.hours ? '<span class="fsrow-hours">' + esc(s.hours) + "</span>" : "") +
        (s.sells ? '<span class="fsrow-sells">' + esc(s.sells) + "</span>" : "") +
        '<span class="fsrow-addr">' + esc(s.address) + "</span></div>" +
        '<a class="fsrow-dir" href="' + esc(directionsURL(s)) +
        '" target="_blank" rel="noopener">Directions</a></li>';
    }).join("");

    // clicking a row flies to its pin
    Array.prototype.forEach.call(listEl.querySelectorAll(".fsrow"), function (el) {
      el.addEventListener("click", function (e) {
        if (e.target.classList.contains("fsrow-dir")) return;
        var s = shown[+el.dataset.i];
        if (hasMap && s && s._marker) {
          map.flyTo([s.lat, s.lng], 15, { duration: .6 });
          s._marker.openPopup();
          document.getElementById("fsmap").scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    });
  }

  // filter chips, built from the tags actually present
  var present = {};
  stands.forEach(function (s) { (s.tags || []).forEach(function (t) { present[t] = 1; }); });
  var chips = document.getElementById("fschips");
  if (chips) {
    var html = ['<button class="fschip is-on" data-t="all">All</button>'];
    Object.keys(TAG_LABELS).forEach(function (t) {
      if (present[t]) html.push('<button class="fschip" data-t="' + t + '">' + TAG_LABELS[t] + "</button>");
    });
    chips.innerHTML = html.join("");
    chips.addEventListener("click", function (e) {
      var b = e.target.closest(".fschip"); if (!b) return;
      active = b.dataset.t;
      Array.prototype.forEach.call(chips.children, function (c) { c.classList.toggle("is-on", c === b); });
      render();
    });
  }

  render();
}

function fail(msg) {
  var el = document.getElementById("fsmap");
  if (el) el.innerHTML = '<p class="fsfail">' + esc(msg) +
    ' <a href="https://www.google.com/maps/d/viewer?mid=1UYfvCLGpxkbZj_mduyWE9x5usdOd-ow" target="_blank" rel="noopener">Open the map in Google Maps</a></p>';
}

(function () {
  function useJSON() {
    fetch(FALLBACK).then(function (r) { return r.json(); })
      .then(function (d) { boot(d.stands || []); })
      .catch(function () { fail("The map could not load."); });
  }

  if (SHEET_CSV) {
    fetch(SHEET_CSV)
      .then(function (r) { if (!r.ok) throw 0; return r.text(); })
      .then(function (t) {
        var s = rowsToStands(parseCSV(t));
        if (s.length) boot(s); else useJSON();   // empty sheet must not empty the map
      })
      .catch(useJSON);
  } else {
    useJSON();
  }
})();
