// Apply the saved palette before the stylesheet/app renders. Keep the key in sync with preferences.ts.
(() => {
  let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  try { const saved = localStorage.getItem('tranuga.theme.v1'); if (saved === 'light' || saved === 'dark') theme = saved; } catch {}
  document.documentElement.dataset.theme = theme;
})();
