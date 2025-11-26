export function isBetaEnabled(settings) {
  if (settings && settings.betaEnabled) return true;
  if (typeof document === 'undefined') return false;
  const body = document.body;
  if (!body) return false;
  try {
    if (typeof body.hasAttribute === 'function' && body.hasAttribute('data-beta')) {
      return true;
    }
  } catch {}
  const dataset = body.dataset;
  if (dataset && ('beta' in dataset)) {
    return true;
  }
  return false;
}
