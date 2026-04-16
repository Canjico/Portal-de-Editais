(function () {
  function ensureLeadingSlash(value) {
    const text = String(value || "").trim();
    if (!text) return "/";
    return text.startsWith("/") ? text : `/${text}`;
  }

  function trimTrailingSlashes(value) {
    const normalized = ensureLeadingSlash(value);
    if (normalized.length <= 1) return normalized;
    return normalized.replace(/\/+$/, "");
  }

  function detectAthosBasePath() {
    let pathname = String(window.location.pathname || "");
    try {
      pathname = decodeURIComponent(pathname);
    } catch (_) {}

    const match = pathname.match(/^(.*?\/athos)(?:\/|$)/i);
    if (match && match[1]) return trimTrailingSlashes(match[1]);
    return "/athos";
  }

  function toAbsoluteUrl(path) {
    const normalized = ensureLeadingSlash(path || "/");
    try {
      return new URL(normalized, window.location.origin).toString();
    } catch (_) {
      return normalized;
    }
  }

  function setMetaTag(attribute, key, content) {
    const safe = String(content || "").trim();
    if (!safe) return;

    const selector = `meta[${attribute}="${key}"]`;
    let element = document.querySelector(selector);
    if (!element) {
      element = document.createElement("meta");
      element.setAttribute(attribute, key);
      document.head.appendChild(element);
    }

    element.setAttribute("content", safe);
  }

  function syncCanonicalUrl() {
    const canonicalUrl = window.location.href.split("#")[0];
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute("href", canonicalUrl);
    setMetaTag("property", "og:url", canonicalUrl);
  }

  function applyHeaderLinks() {
    const athosBasePath = detectAthosBasePath();
    const landingPageUrl = toAbsoluteUrl(athosBasePath);
    const brandLink = document.getElementById("headerBrandLink");
    const platformLink = document.getElementById("headerPlatformLink");

    if (brandLink) brandLink.href = landingPageUrl;
    if (platformLink) platformLink.href = landingPageUrl;
  }

  document.addEventListener("DOMContentLoaded", function () {
    applyHeaderLinks();
    syncCanonicalUrl();
  });
})();
