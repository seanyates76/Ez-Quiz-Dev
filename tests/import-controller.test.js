'use strict';

const { loadBrowserModule } = require('./utils');

describe('ImportController', () => {
  let ImportController;

  beforeAll(() => {
    ({ ImportController } = loadBrowserModule('public/js/import-controller.js', ['ImportController']));
  });

  test('start increments token and aborts previous controllers', () => {
    const ctl = new ImportController();
    const first = ctl.start();
    expect(first.token).toBe(1);

    let aborted = false;
    first.signal.addEventListener('abort', () => { aborted = true; });

    const second = ctl.start();
    expect(second.token).toBe(2);
    expect(aborted).toBe(true);
    expect(ctl.isCurrent(second.token)).toBe(true);
    expect(ctl.isCurrent(first.token)).toBe(false);
  });

  test('finish only clears pending for the current token', () => {
    const ctl = new ImportController();
    const first = ctl.start();
    const second = ctl.start();

    ctl.finish(first.token);
    expect(ctl.pending).toBe(true);
    expect(ctl.abortController).not.toBeNull();

    ctl.finish(second.token);
    expect(ctl.pending).toBe(false);
    expect(ctl.abortController).toBeNull();
  });

  test('cancel aborts the current signal, invalidates the token, and resets pending state', () => {
    const ctl = new ImportController();
    const { token, signal } = ctl.start();

    let aborted = false;
    signal.addEventListener('abort', () => { aborted = true; });

    ctl.cancel();
    expect(aborted).toBe(true);
    expect(ctl.pending).toBe(false);
    expect(ctl.abortController).toBeNull();
    expect(ctl.isCurrent(token)).toBe(false);
  });
});
