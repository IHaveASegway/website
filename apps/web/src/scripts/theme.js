(() => {
  const root = document.documentElement;
  const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
  const colors = metas.map((meta) => meta.content);
  const set = (theme) => {
    root.dataset.theme = theme;
    const chosen = metas.findIndex((meta) => meta.media.includes(theme));
    metas.forEach((meta, i) => (meta.content = colors[chosen < 0 ? i : chosen]));
  };
  const session = (use) => {
    try {
      return use(sessionStorage);
    } catch {
      return null;
    }
  };
  const read = () => session((storage) => storage.getItem('theme') ?? 'system');
  const apply = (stored) => set(stored === 'dark' || stored === 'light' ? stored : 'system');
  apply(read());
  addEventListener('pageshow', (event) => {
    if (event.persisted) apply(read() ?? root.dataset.theme);
  });

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-theme-toggle]')) return;
    const os = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    const order = ['system', os === 'dark' ? 'light' : 'dark', os];
    const theme = order[(order.indexOf(root.dataset.theme) + 1) % order.length];
    session((storage) =>
      theme === 'system' ? storage.removeItem('theme') : storage.setItem('theme', theme),
    );
    set(theme);
  });
})();
