// Browser fullscreen helpers for FullscreenButton.cs (WebGL builds only).
mergeInto(LibraryManager.library, {

  // 1 on phones and tablets (including iPads, which report themselves as Macs).
  Fullscreen_IsMobile: function () {
    var ua = navigator.userAgent || "";
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return 1;
    return (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)) ? 1 : 0;
  },

  // 1 if the browser lets a page go fullscreen (Android Chrome, iPad Safari). iPhone Safari does not.
  Fullscreen_IsSupported: function () {
    var d = document.documentElement;
    return (d.requestFullscreen || d.webkitRequestFullscreen) ? 1 : 0;
  },

  // 1 while fullscreen, or when opened from the home screen (already has no browser bars).
  Fullscreen_IsActive: function () {
    if (document.fullscreenElement || document.webkitFullscreenElement) return 1;
    if (window.navigator.standalone) return 1;
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return 1;
    if (window.matchMedia && window.matchMedia("(display-mode: fullscreen)").matches) return 1;
    return 0;
  },

  // Browsers only allow fullscreen from inside a tap. Unity handles taps a frame late, so this is called when
  // the button is pressed down and goes fullscreen when the finger lifts, which still counts as the tap.
  Fullscreen_RequestOnRelease: function (lockLandscape) {
    var done = false;
    function go() {
      if (done) return;
      done = true;
      document.removeEventListener("pointerup", go, true);
      document.removeEventListener("touchend", go, true);
      document.removeEventListener("click", go, true);

      var d = document.documentElement;
      var p = null;
      try {
        if (d.requestFullscreen) p = d.requestFullscreen({ navigationUI: "hide" });
        else if (d.webkitRequestFullscreen) d.webkitRequestFullscreen();
      } catch (e) { console.warn("Fullscreen failed", e); }

      if (lockLandscape && screen.orientation && screen.orientation.lock) {
        Promise.resolve(p).then(function () {
          return screen.orientation.lock("landscape");
        }).catch(function () { /* not allowed on this device: ignore */ });
      }
    }
    document.addEventListener("pointerup", go, true);
    document.addEventListener("touchend", go, true);
    document.addEventListener("click", go, true);
  }
});
