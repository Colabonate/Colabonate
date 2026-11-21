(function() {
  try {
    // Mirrors packages/utils/useTheme.tsx's four-state preference model
    // ('system' | 'time' | 'light' | 'dark') so the pre-mount guess matches
    // what ThemeProvider resolves a moment later — a mismatch here (e.g.
    // treating 'time' as unrecognized and falling back to the OS media
    // query) shows the wrong background until React mounts and corrects it.
    // TIME_LIGHT_START_HOUR/TIME_DARK_START_HOUR must stay in sync with the
    // constants of the same name in useTheme.tsx.
    var TIME_LIGHT_START_HOUR = 6;
    var TIME_DARK_START_HOUR = 18;
    var stored = localStorage.getItem('colabonate-theme');
    var theme;
    if (stored === 'dark' || stored === 'light') {
      theme = stored;
    } else if (stored === 'time') {
      var hour = new Date().getHours();
      theme = (hour < TIME_LIGHT_START_HOUR || hour >= TIME_DARK_START_HOUR) ? 'dark' : 'light';
    } else {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'dark') {
      document.documentElement.style.backgroundColor = '#1e242c';
    }
    var r = document.documentElement.style;
    r.setProperty('--safe-bottom', 'env(safe-area-inset-bottom, 0px)');
    r.setProperty('--safe-top', 'env(safe-area-inset-top, 0px)');
    r.setProperty('--safe-left', 'env(safe-area-inset-left, 0px)');
    r.setProperty('--safe-right', 'env(safe-area-inset-right, 0px)');
  } catch (e) {
    // Ignore localStorage errors
  }
})();
