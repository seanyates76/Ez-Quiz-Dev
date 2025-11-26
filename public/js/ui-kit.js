(() => {
  const root = document.documentElement;
  const body = document.body;
  const themeToggle = document.getElementById('kitThemeToggle');
  const betaToggle = document.getElementById('kitBetaToggle');
  const brand = document.getElementById('kitBrand');
  const stamp = document.getElementById('kitTimestamp');
  if (stamp) stamp.textContent = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  const updateBrand = () => {
    if (!brand) return;
    const mode = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const src = brand.dataset[mode];
    if (src) brand.src = src;
  };

  function setTheme(next) {
    root.setAttribute('data-theme', next);
    localStorage.setItem('kit-theme', next);
    themeToggle.textContent = `Theme: ${next === 'light' ? 'Light' : 'Dark'}`;
    themeToggle.setAttribute('aria-pressed', String(next === 'light'));
    updateBrand();
  }

  function setBeta(enabled) {
    if (enabled) {
      body.dataset.beta = 'true';
      betaToggle.textContent = 'Beta: On';
      localStorage.setItem('kit-beta', '1');
    } else {
      body.removeAttribute('data-beta');
      betaToggle.textContent = 'Beta: Off';
      localStorage.removeItem('kit-beta');
    }
    betaToggle.setAttribute('aria-pressed', String(enabled));
  }

  themeToggle.addEventListener('click', () => {
    const current = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    setTheme(current === 'light' ? 'dark' : 'light');
  });
  betaToggle.addEventListener('click', () => setBeta(!body.dataset.beta));

  const storedTheme = localStorage.getItem('kit-theme');
  setTheme(storedTheme === 'light' ? 'light' : 'dark');
  const storedBeta = localStorage.getItem('kit-beta') === '1';
  setBeta(storedBeta);
})();
