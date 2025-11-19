'use strict';

const { readFile } = require('./utils');

describe('public/styles.css core tokens', () => {
  const css = readFile('public/styles.css');

  const tokenAssertions = [
    ['--field', /--field\s*:\s*var\(--c-input\)/],
    ['--text', /--text\s*:\s*var\(--c-text\)/],
    ['--c-page', /--c-page\s*:\s*var\(--surface-0\)/],
    ['--c-accent', /--c-accent\s*:\s*var\(--accent\)/],
    ['--c-success', /--c-success\s*:\s*var\(--positive\)/],
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
    expect(css).toMatch(/:root\[data-theme="light"\][^}]*--c-accent-active:var\(--accent-press\)/);
  });
});

describe('public/styles.tokens.css design tokens', () => {
  const tokens = readFile('public/styles.tokens.css');

  const baseTokenAssertions = [
    ['type scale', /--fs-h1\s*:\s*32px/],
    ['radius scale', /--r-sm\s*:\s*10px/],
    ['spacing scale', /--s-32\s*:\s*32px/],
    ['dark palette', /--theme-dark-surface-0\s*:\s*oklch\(/],
    ['light palette', /--theme-light-surface-0\s*:\s*oklch\(/],
  ];

  test.each(baseTokenAssertions)('defines %s tokens', (_, pattern) => {
    expect(tokens).toMatch(pattern);
  });

  test('exposes explicit theme selectors and prefers-color-scheme fallback', () => {
    expect(tokens).toMatch(/:root\[data-theme="light"\]\s*\{/);
    expect(tokens).toMatch(/:root\[data-theme="dark"\]\s*\{/);
    expect(tokens).toMatch(/@media\s*\(prefers-color-scheme:\s*light\)\s*\{\s*:root:not\(\[data-theme\]\)\s*\{/);
  });

  test('maps theme aliases to public tokens', () => {
    const aliasPatterns = [
      /--surface-0\s*:\s*var\(--theme-surface-0\)/,
      /--surface-1\s*:\s*var\(--theme-surface-1\)/,
      /--text\s*:\s*var\(--theme-text\)/,
      /--muted\s*:\s*var\(--theme-muted\)/,
      /--accent\s*:\s*var\(--theme-accent\)/,
      /--positive\s*:\s*var\(--theme-positive\)/,
      /--negative\s*:\s*var\(--theme-negative\)/,
      /--focus-outer\s*:\s*var\(--theme-focus-outer\)/,
    ];
    aliasPatterns.forEach((pattern) => {
      expect(tokens).toMatch(pattern);
    });
  });
});
