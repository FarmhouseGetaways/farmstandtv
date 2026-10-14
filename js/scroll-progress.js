/* Scroll line (Cory, 14 Oct 2026): a thin line across the top of the window that fills from left
 * to right as the page is scrolled down and shrinks back as it is scrolled up.
 *
 * - Only on long pages: at least two screens of content. Short pages never show it.
 * - Colour: data-color on the script tag if given; otherwise near-black over a light ground and
 *   near-white over a dark one, judged from what is at the top of the window when the page opens
 *   (usually a header that stays there), then the page background, then the theme-color.
 * - Facebook's and Instagram's in-app browsers draw their own line under the address bar, so this
 *   one stays off there rather than show two.
 * - It follows the scroll position directly (no animation), so reduced-motion settings need nothing.
 *
 * One copy of this file lives in each site's repo; the master is
 * reports/scroll-progress/scroll-progress.js in the projects folder. Keep them identical. */
(function () {
  if (/FBAN|FBAV|FB_IAB|Instagram/i.test(navigator.userAgent || "")) return;

  var me = document.currentScript;
  var chosen = me && me.getAttribute("data-color");
  var bar = document.createElement("div");
  bar.setAttribute("aria-hidden", "true");
  bar.style.cssText = "position:fixed;top:0;left:0;width:100%;height:3px;z-index:2147483647;" +
    "pointer-events:none;transform-origin:0 50%;transform:scaleX(0);opacity:0;transition:opacity .2s";

  function dark(r, g, b) { return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.45; }
  // The page's background colour; when it is a gradient or image instead (no solid colour set),
  // fall back to the site's theme-color, which these sites all set to their dark or light ground.
  function solid(el) {
    var m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
    return m && (m.length < 4 || +m[3] > 0.5) ? m : null;
  }
  function bgIsDark() {
    // What the line actually sits on: usually a header that stays at the top of the window.
    var el = document.elementFromPoint(window.innerWidth / 2, 2);
    for (; el && el !== document.body; el = el.parentElement) {
      if (el.tagName === "IMG" || el.tagName === "VIDEO") break;
      var c = solid(el);
      if (c) return dark(c[0], c[1], c[2]);
    }
    var els = [document.body, document.documentElement];
    for (var i = 0; i < els.length; i++) {
      var m = getComputedStyle(els[i]).backgroundColor.match(/[\d.]+/g);
      if (m && (m.length < 4 || +m[3] > 0.5)) return dark(m[0], m[1], m[2]);
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    var hex = meta && (meta.getAttribute("content") || "").match(/^#([0-9a-f]{6})$/i);
    if (hex) {
      var n = parseInt(hex[1], 16);
      return dark(n >> 16, (n >> 8) & 255, n & 255);
    }
    return false;
  }

  var ticking = false;
  function update() {
    ticking = false;
    var doc = document.documentElement;
    var h = Math.max(doc.scrollHeight, document.body.scrollHeight);
    var max = h - window.innerHeight;
    if (h < window.innerHeight * 2 || max <= 0) { bar.style.opacity = "0"; return; }
    var p = Math.min(1, Math.max(0, (window.pageYOffset || doc.scrollTop) / max));
    bar.style.transform = "scaleX(" + p.toFixed(4) + ")";
    bar.style.opacity = p > 0.002 ? "1" : "0";
  }
  function later() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }

  function start() {
    bar.style.background = chosen || (bgIsDark() ? "#f2f2f2" : "#1f1f1f");
    document.body.appendChild(bar);
    update();
    if (window.ResizeObserver) new ResizeObserver(later).observe(document.body);
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
  window.addEventListener("scroll", later, { passive: true });
  window.addEventListener("resize", later);
  window.addEventListener("load", later);
})();
