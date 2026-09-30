// Applies the stored language hint to <html lang dir> before first paint (ADR-0009 §2). Arabic RTL is the default.
// A same-origin classic script (the CSP allows 'self' scripts only; no inline script).
(function () {
  try {
    var locale = window.localStorage.getItem("mth.locale");
    if (locale === "en" || locale === "ar") {
      document.documentElement.lang = locale;
      document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    }
  } catch {
    // Storage unavailable: keep the Arabic RTL default from index.html.
  }
})();
