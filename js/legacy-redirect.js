/* v1.5: legacy editor recovery URLs — index.html?edit=<slug> now lives at
   build.html. Client-side twin of the /index.html rule in _redirects (covers
   hosts without _redirects support, e.g. the local http-server).
   Extracted from an inline <script> so the Content-Security-Policy can ship
   script-src 'self'. Loaded synchronously in <head>, never deferred. */
if (new URLSearchParams(location.search).has('edit')) {
  location.replace('build.html' + location.search + location.hash);
}