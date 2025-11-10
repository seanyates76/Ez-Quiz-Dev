const root = typeof globalThis !== 'undefined' ? globalThis : global;
const STATE_KEY = Symbol.for('ezq.tests.setup.state');

const defaultState = Object.freeze({
  MAX_QUESTIONS: 30,
  settings: { betaEnabled: true },
  config: {},
});

const stubRegistration = {
  scope: '/',
  update: () => Promise.resolve(),
  unregister: () => Promise.resolve(true),
  addEventListener: () => {},
  removeEventListener: () => {},
  active: null,
  installing: null,
  waiting: null,
};

const serviceWorkerStub = {
  controller: null,
  register: () => Promise.resolve(stubRegistration),
  getRegistration: () => Promise.resolve(null),
  getRegistrations: () => Promise.resolve([]),
  addEventListener: () => {},
  removeEventListener: () => {},
};

Object.defineProperty(serviceWorkerStub, 'ready', {
  configurable: true,
  enumerable: true,
  get() {
    return Promise.resolve(stubRegistration);
  },
});

const clone = (value) => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
};

const ensureWindow = () => {
  if (!root.window || typeof root.window !== 'object') {
    root.window = {};
  }
  return root.window;
};

const ensureNavigator = (win) => {
  const host = ensureWindow();
  const baseNavigator = (root.navigator && typeof root.navigator === 'object') ? root.navigator : {};
  const navigatorTarget = (win && typeof win.navigator === 'object') ? win.navigator : baseNavigator;

  if (!root.navigator || typeof root.navigator !== 'object') {
    root.navigator = navigatorTarget;
  }
  if (!host.navigator || typeof host.navigator !== 'object') {
    host.navigator = navigatorTarget;
  }

  const descriptor = navigatorTarget && Object.getOwnPropertyDescriptor(navigatorTarget, 'serviceWorker');
  if (!descriptor || descriptor.value !== serviceWorkerStub) {
    Object.defineProperty(navigatorTarget, 'serviceWorker', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: serviceWorkerStub,
    });
  }

  return navigatorTarget;
};

const applyEzqDefaults = (win) => {
  const current = (win && typeof win.__EZQ__ === 'object' && win.__EZQ__) || {};
  const merged = {
    MAX_QUESTIONS: defaultState.MAX_QUESTIONS,
    settings: { ...defaultState.settings },
    config: { ...defaultState.config },
  };

  if (current && typeof current === 'object') {
    if (Number.isFinite(current.MAX_QUESTIONS)) {
      merged.MAX_QUESTIONS = Math.max(1, Math.trunc(current.MAX_QUESTIONS));
    }
    if (current.settings && typeof current.settings === 'object') {
      merged.settings = { ...merged.settings, ...clone(current.settings) };
    }
    if (current.config && typeof current.config === 'object') {
      merged.config = { ...merged.config, ...clone(current.config) };
    }
  }

  if (typeof merged.settings.betaEnabled !== 'boolean') {
    merged.settings.betaEnabled = defaultState.settings.betaEnabled;
  }

  win.__EZQ__ = merged;
  root.__EZQ__ = merged;
  return merged;
};

const bootstrap = () => {
  const win = ensureWindow();
  const ezq = applyEzqDefaults(win);
  ensureNavigator(win);
  return ezq;
};

bootstrap();

const state = (() => {
  const existing = root[STATE_KEY];
  if (existing && typeof existing === 'object') return existing;
  const next = { beforeEachInstalled: false, afterEachInstalled: false };
  root[STATE_KEY] = next;
  return next;
})();

const installHooks = () => {
  if (typeof beforeEach === 'function' && !state.beforeEachInstalled) {
    beforeEach(() => {
      bootstrap();
    });
    state.beforeEachInstalled = true;
  }
  if (typeof afterEach === 'function' && !state.afterEachInstalled) {
    afterEach(() => {
      const win = ensureWindow();
      applyEzqDefaults(win);
      ensureNavigator(win);
    });
    state.afterEachInstalled = true;
  }
};

installHooks();
