const root = typeof globalThis !== 'undefined' ? globalThis : global;

if (!root.window || typeof root.window !== 'object') {
  root.window = {};
}
const win = root.window;

const ensureEzq = () => {
  const defaultConfig = {
    MAX_QUESTIONS: 30,
    settings: {
      betaEnabled: true,
    },
  };
  if (!win.__EZQ__ || typeof win.__EZQ__ !== 'object') {
    win.__EZQ__ = JSON.parse(JSON.stringify(defaultConfig));
  } else {
    const target = win.__EZQ__;
    if (!('MAX_QUESTIONS' in target) || !Number.isFinite(target.MAX_QUESTIONS)) {
      target.MAX_QUESTIONS = defaultConfig.MAX_QUESTIONS;
    }
    const settings = target.settings && typeof target.settings === 'object' ? target.settings : {};
    if (typeof settings.betaEnabled !== 'boolean') {
      settings.betaEnabled = defaultConfig.settings.betaEnabled;
    }
    target.settings = settings;
  }
  if (!('config' in win.__EZQ__)) {
    win.__EZQ__.config = {};
  }
  if (!('settings' in win.__EZQ__)) {
    win.__EZQ__.settings = { betaEnabled: true };
  }
  if (!('MAX_QUESTIONS' in win.__EZQ__)) {
    win.__EZQ__.MAX_QUESTIONS = 30;
  }
  root.__EZQ__ = win.__EZQ__;
};

ensureEzq();

if (!root.navigator || typeof root.navigator !== 'object') {
  root.navigator = {};
}
const stubRegistration = {
  scope: '/',
  update: () => Promise.resolve(),
  unregister: () => Promise.resolve(true),
  addEventListener: () => {},
  waiting: null,
};

const serviceWorkerStub = {
  controller: null,
  ready: Promise.resolve(stubRegistration),
  register: () => Promise.resolve(stubRegistration),
  getRegistration: () => Promise.resolve(null),
  getRegistrations: () => Promise.resolve([]),
  addEventListener: () => {},
};

Object.defineProperty(root.navigator, 'serviceWorker', {
  value: serviceWorkerStub,
  configurable: true,
  writable: true,
});

if (!win.navigator || typeof win.navigator !== 'object') {
  win.navigator = root.navigator;
}
