(function() {
  var messages = [
    'Buy, sell & cooperate, directly peer-to-peer.',
    'Bitcoin & Lightning: your keys, your money, instantly.',
    'Nostr identity: portable, sovereign, yours.',
    'Open marketplace. No gatekeepers. No platform fees.',
    'Smart escrow & ticket system for trusted trades.',
    'Built for self-determined people, censorship-resistant.'
  ];
  var el = document.getElementById('app-splash-subtitle');
  if (!el || messages.length < 2) return;
  var i = 0;
  var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setInterval(function() {
    i = (i + 1) % messages.length;
    if (prefersReduced) { el.textContent = messages[i]; return; }
    el.classList.add('is-fading');
    setTimeout(function() {
      el.textContent = messages[i];
      el.classList.remove('is-fading');
    }, 360);
  }, 4000);
})();
