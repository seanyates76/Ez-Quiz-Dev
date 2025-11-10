export function isBetaEnabled(settings) {
  if (settings && settings.betaEnabled) return true;
  if (typeof document === 'undefined') return false;
  const body = document.body;
  if (!body) return false;
  try {
    if (body.dataset && ('beta' in body.dataset)) return true;
    if (typeof body.hasAttribute === 'function' && body.hasAttribute('data-beta')) return true;
    if (typeof body.getAttribute === 'function' && body.getAttribute('data-beta') !== null) return true;
  } catch {}
  return false;
}
