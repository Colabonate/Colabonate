(function() {
  // Anti-FOUC guard for production prerendered snapshots (ADR-287/294).
  // Runs synchronously as the parser reaches this point — before #root and
  // main.tsx's deferred `type="module"` script get a turn, and before the
  // browser can composite a first paint of the raw prerendered #root content
  // (which may be stale relative to this visitor's real client-side state —
  // e.g. a notice or section the visitor had already dismissed, captured in
  // its build-time default state). The snapshot bakes #app-splash as
  // `app-splash--hidden` for bots/crawlers that never execute this script;
  // a real browser is about to remount over it (ADR-287 D1) regardless, so
  // show the splash now instead of leaving that window exposed.
  //
  // ORDERING IS LOAD-BEARING: this script (and the #app-splash element it
  // targets) must stay BEFORE #root in index.html. Placed after it, a slow
  // connection can progressively paint the stale #root markup before this
  // guard ever runs — which is exactly how old Beta-notice content used to
  // flash on reload. Keep index.html's body order: #app-splash → this guard →
  // #root.
  // No-op in dev: the raw index.html template never carries the `--hidden`
  // class (only the prerender build bakes it in), so there's nothing to hide.
  var el = document.getElementById('app-splash');
  if (!el) return;
  el.classList.remove('app-splash--hidden');
  el.classList.add('app-splash--force-visible');
})();
