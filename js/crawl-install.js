/* Home-screen tip for the crawl pages only. */
(function () {
  var tip = document.getElementById("install-tip");
  if (!tip) return;
  var KEY = "fstv-crawl-install-hide";
  try { if (localStorage.getItem(KEY)) return; } catch (e) { /* keep showing */ }
  var standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone;
  if (standalone) return;

  var text = document.getElementById("install-text");
  var go = document.getElementById("install-go");
  var close = document.getElementById("install-x");
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  tip.hidden = false;
  if (ios) {
    if (text) text.textContent = "Tap Share, then Add to Home Screen.";
  } else if (text) {
    text.textContent = "Add Xmas Crawl to your home screen.";
  }

  var deferred = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    if (go) go.hidden = false;
  });
  if (go) go.addEventListener("click", function () {
    if (!deferred) return;
    deferred.prompt();
    deferred.userChoice.then(function () {
      deferred = null;
      tip.hidden = true;
    });
  });
  if (close) close.addEventListener("click", function () {
    tip.hidden = true;
    try { localStorage.setItem(KEY, "1"); } catch (err) { /* dismissed for this view */ }
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/crawl-sw.js").catch(function () {});
  }
})();
