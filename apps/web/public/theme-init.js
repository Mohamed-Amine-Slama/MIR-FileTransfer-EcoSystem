/*
 * Applies the stored theme BEFORE first paint.
 *
 * WHY THIS IS A FILE AND NOT AN INLINE SCRIPT.
 * The conventional fix for theme flash is an inline <script> injected with
 * React's dangerouslySetInnerHTML. That is forbidden here, and not by taste:
 * next.config.mjs weakens the CSP with script-src 'unsafe-inline' because
 * Next's App Router streams RSC payloads through inline script tags, and the
 * justification for accepting that weakening is that this application contains
 * no path by which attacker markup reaches the document. That claim is
 * asserted by lib/security/xss-surface.test.ts, which fails the build on
 * dangerouslySetInnerHTML anywhere under app/, components/, or lib/.
 *
 * A static file loaded with next/script strategy="beforeInteractive" gets the
 * same result: it is same-origin, so script-src 'self' already allows it; it
 * runs before hydration, so there is no flash; and the routes stay statically
 * prerendered, which a cookie-driven server-rendered theme would have cost us
 * (next.config.mjs is explicit that forcing dynamic rendering app-wide is an
 * architecture decision, not a config tweak).
 *
 * Keep this file dependency-free and synchronous. It runs on every page load
 * before anything else, and it must never throw: a private window, cleared
 * site data, or a browser configured to block storage all make localStorage
 * throw on ACCESS, not just return null.
 */
(function () {
  try {
    var stored = window.localStorage.getItem('mir.theme');
    // "system" deliberately sets no attribute, which leaves the
    // prefers-color-scheme media query in globals.css in charge. Anything
    // unrecognised is treated the same way, so a corrupted value degrades to
    // following the OS rather than pinning a theme nobody chose.
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.setAttribute('data-theme', stored);
    }
  } catch (_) {
    /* Storage unavailable. The OS preference governs, which is a fine answer. */
  }
})();
