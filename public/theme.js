// Apply the saved palette before the stylesheet/app renders. Keep the key in sync with preferences.ts.
(() => {
  let theme = 'dark';
  try { const saved = localStorage.getItem('tranuga.theme.v1'); if (saved === 'light' || saved === 'dark') theme = saved; } catch {}
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#15221b' : '#b92535');
})();
