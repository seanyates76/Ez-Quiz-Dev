// EZ Quiz: lightweight auto-refresh via ETag/Last-Modified polling
// Checks index revalidation every 30s (or on visibility) without inline scripts (CSP-safe)
(function(){
  if(document.documentElement.dataset.edition === 'standalone') return;
  const CHECK_INTERVAL = 30000; // 30s (more responsive on mobile shortcuts)
  let currentTag = null;
  let reloadedOnControllerChange = false;

  async function checkForUpdate(){
    // Avoid noisy network errors when offline
    if(typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return;
    // Only poll when tab is visible
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    try{
      const url = window.location.pathname || '/';
      const res = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        headers: { 'Accept': 'text/html' },
      });
      if(!res.ok) return;
      // Only use stable validators; avoid per-request IDs that cause loops
      const tag = res.headers.get('etag') || res.headers.get('last-modified');
      if(currentTag && tag && tag !== currentTag){
        // Only reload automatically while on main menu (idle)
        const mode = (window.EZQ && window.EZQ.mode) || 'idle';
        if(mode === 'idle'){
          window.location.reload(true);
          return;
        }
        // Otherwise, mark update to apply when returning to main menu
        try{ localStorage.setItem('ezq.update.ready','1'); }catch{}
      }
      if(tag) currentTag = tag;
    }catch{ /* silently ignore */ }
  }

  checkForUpdate();
  setInterval(checkForUpdate, CHECK_INTERVAL);

  // Also check when the app becomes visible again
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Small delay to allow network to settle on wake
      setTimeout(checkForUpdate, 500);
    }
  });

  // In PWA/standalone, reload when a new SW takes control
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadedOnControllerChange) return;
      reloadedOnControllerChange = true;
      try { localStorage.removeItem('ezq.update.ready'); } catch {}
      // Force a hard reload to pick up new assets
      location.reload(true);
    });
  }
})();
