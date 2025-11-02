'use strict';

const { readFile } = require('./utils');

describe('public/styles.css core tokens', () => {
  const css = readFile('public/styles.css');

  const tokenAssertions = [
    ['--field', /--field\s*:\s*var\(--c-input\)/],
    ['--text', /--text\s*:\s*var\(--c-text\)/],
    ['--radius-card', /--radius-card\s*:\s*calc\(/],
    ['--shadow-card', /--shadow-card\s*:\s*0\s+4px\s+14px/],
  ];

  test.each(tokenAssertions)('defines %s token', (_, pattern) => {
    expect(css).toMatch(pattern);
  });

  test('declares :root light theme overrides', () => {
    expect(css).toMatch(/:root\s*\{/);
    expect(css).toMatch(/:root\[data-theme="light"\]\s*\{/);
    expect(css).toMatch(/:root\[data-theme="dark"\]\s*\{/);
    expect(css).toMatch(/--c-page:#f6f8fb;/);
    expect(css).toMatch(/--c-text:#0d1117;/);
  });
});
