(function(){
  var root = document.documentElement;
  var KEY = 'ezq.theme';
  var stored = 'system';
  try {
    root.setAttribute('data-theme-pending', '1');
    root.setAttribute('aria-busy', 'true');
  } catch (err) {}
  var syncTheme = function(choiceValue, appliedValue){
    var previous = window.__EZQ_PRELOADED_THEME && window.__EZQ_PRELOADED_THEME.applied;
    try { root.setAttribute('data-theme', appliedValue); } catch (err) {}
    try {
      root.classList.add('theme-ready');
      root.removeAttribute('data-theme-pending');
      root.removeAttribute('aria-busy');
    } catch (err) {}
    window.__EZQ_PRELOADED_THEME = { choice: choiceValue, applied: appliedValue, previous: previous };
  };
  window.__EZQ_SYNC_THEME = syncTheme;
  var createSystemThemeHandler = window.__EZQ_CREATE_SYSTEM_THEME_HANDLER || function(syncFn){
    return function(matches){
      if ((window.__EZQ_PRELOADED_THEME && window.__EZQ_PRELOADED_THEME.choice) === 'system') {
        syncFn('system', matches ? 'dark' : 'light');
      }
    };
  };
  window.__EZQ_CREATE_SYSTEM_THEME_HANDLER = createSystemThemeHandler;
  var handleSystemChange = createSystemThemeHandler(syncTheme);
  window.__EZQ_SYSTEM_THEME_HANDLER = handleSystemChange;
  try {
    var raw = localStorage.getItem(KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') {
      stored = raw;
    }
  } catch (err) {}
  var choice = stored;
  var applied = choice;
  if (choice !== 'light' && choice !== 'dark') {
    applied = 'dark';
    try {
      var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
      applied = mq && mq.matches ? 'dark' : 'light';
      window.__EZQ_SYSTEM_MQL = mq;
      var listener = function(ev){
        var fn = window.__EZQ_SYSTEM_THEME_HANDLER || handleSystemChange;
        if (typeof fn === 'function') {
          fn(ev.matches);
        }
      };
      if (mq && mq.addEventListener) {
        mq.addEventListener('change', listener);
      } else if (mq && mq.addListener) {
        mq.addListener(listener);
      }
      window.__EZQ_SYSTEM_THEME_LISTENER = listener;
    } catch (err) { applied = 'dark'; }
  }
  syncTheme(choice, applied || 'dark');
})();
