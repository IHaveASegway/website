// Pre-paint theme and the toggle's click handler. Inlined and hashed: see Base.astro.
(() => {
  const root = document.documentElement;
  const set = (theme, saved) => {
    root.dataset.theme = theme;
    root.toggleAttribute('data-saved', saved);
  };
  let stored = null;
  try {
    stored = localStorage.getItem('theme');
  } catch {
    // Storage is blocked: follow the OS.
  }
  if (stored === 'dark' || stored === 'light') set(stored, true);
  else set('system', false);

  // System, then the theme the OS is not showing: only the return to System looks the same.
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-theme-toggle]')) return;
    const os = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    const order = ['system', os === 'dark' ? 'light' : 'dark', os];
    const theme = order[(order.indexOf(root.dataset.theme) + 1) % order.length];
    let saved = false;
    try {
      if (theme === 'system') localStorage.removeItem('theme');
      else localStorage.setItem('theme', theme);
      saved = theme !== 'system';
    } catch {
      // Storage refused the choice: it holds for this page, and the label does not say saved.
    }
    set(theme, saved);
  });
})();
