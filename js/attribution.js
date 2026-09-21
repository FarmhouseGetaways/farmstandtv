/* Where did this visitor come from?
 *
 * Every form on the site posts six hidden "arrived-*" fields that this fills in,
 * so an inquiry or signup says how the person found us instead of leaving it to
 * be guessed afterwards (Netlify Forms saves what the form posts and nothing about
 * the visit; GA4 only reports totals, never which visitor sent which form).
 *
 * Runs on every page, not only the ones with a form, because the visit that
 * matters is often the FIRST one: an ad click lands on a property page, and the
 * inquiry is sent from /groups a week later. Two touches are kept in this
 * browser's localStorage:
 *   first — the very first visit
 *   last  — the most recent visit that carried a real signal (ad click id,
 *           utm tags, or an outside referrer). Browsing around the site itself
 *           never overwrites it.
 * Nothing here is sent anywhere until the visitor submits a form.
 *
 * localStorage can be blocked or throw (private windows); everything falls back
 * to reading the current visit only.
 */
(function () {
  var KEY = "fg_arrival_v1";
  var OWN = location.hostname.replace(/^www\./, "");

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function write(v) {
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* blocked */ }
  }

  function host(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
  }

  /* One readable line for "how they got here". */
  function label(t) {
    if (t.click) return "Google Ads" + (t.campaign ? " - " + t.campaign : "") + (t.term ? " - keyword: " + t.term : "");
    if (t.fb) return "Facebook / Instagram ad";
    if (t.src) return t.src + (t.medium ? " / " + t.medium : "") + (t.campaign ? " - " + t.campaign : "");
    var h = t.ref;
    if (!h) return "Direct or unknown";
    if (/(^|\.)google\./i.test(h)) return "Google search (free listing)";
    if (/bing\.com$/i.test(h)) return "Bing search";
    if (/duckduckgo\.com$/i.test(h)) return "DuckDuckGo search";
    if (/airbnb\./i.test(h)) return "Airbnb";
    if (/vrbo\.com$|homeaway\./i.test(h)) return "Vrbo";
    if (/(^|\.)(facebook|fb|instagram|l\.instagram)\.com$|^lm\.facebook\.com$/i.test(h)) return "Facebook / Instagram";
    if (/lodgify/i.test(h)) return "Lodgify";
    return "Link from " + h;
  }

  var q = new URLSearchParams(location.search);
  var ref = host(document.referrer);
  if (ref === OWN) ref = "";                       // our own pages are not a source
  var click = q.get("gclid") || q.get("gbraid") || q.get("wbraid") || "";

  var now = {
    at: new Date().toISOString().slice(0, 10),
    landing: location.pathname,
    ref: ref,
    src: q.get("utm_source") || "",
    medium: q.get("utm_medium") || "",
    campaign: q.get("utm_campaign") || "",
    click: click,
    term: q.get("utm_term") || "",
    fb: q.get("fbclid") ? 1 : 0,
  };
  var signal = !!(now.click || now.fb || now.src || now.ref);

  var store = read();
  if (!store.first) store.first = now;
  if (signal) store.last = now;
  write(store);

  function fill() {
    var last = store.last || store.first || now;
    var first = store.first || now;
    var values = {
      "arrived-from": label(last) + " (" + last.at + ")",
      "first-visit-from": label(first) + " (" + first.at + ")",
      "arrived-landing": last.landing,
      "arrived-referrer": last.ref,
      "arrived-campaign": last.campaign || last.src,
      "arrived-click-id": last.click,
    };
    // Netlify strips data-netlify from the published HTML, so forms are found by
    // the arrived-from field they carry, not by that attribute.
    var forms = document.querySelectorAll("form");
    for (var i = 0; i < forms.length; i++) {
      for (var name in values) {
        var el = forms[i].querySelector('input[name="' + name + '"]');
        if (el) el.value = values[name] || "";
      }
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fill);
  else fill();
})();
