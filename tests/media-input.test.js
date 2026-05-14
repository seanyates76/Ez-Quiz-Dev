/** @jest-environment jsdom */
'use strict';

const { loadDocument } = require('./utils');

describe('Media Input (beta) UI', () => {
  let document;

  beforeAll(async () => {
    document = await loadDocument('public/index.html');
  });

  test('has import button flagged as beta-only with accessible labeling', () => {
    const importBtn = document.getElementById('importBtn');
    expect(importBtn).not.toBeNull();
    expect(importBtn.classList.contains('beta-only')).toBe(true);
    expect(importBtn.getAttribute('title')).toMatch(/Attach PDF\/Image/);
    expect(importBtn.getAttribute('aria-label')).toMatch(/Attach PDF or Image/);
  });

  test('file input accepts pdf and images and stays hidden', () => {
    const fileInput = document.getElementById('importFile');
    expect(fileInput).not.toBeNull();
    expect(fileInput.getAttribute('type')).toBe('file');

    const accept = fileInput.getAttribute('accept') || '';
    expect(accept.includes('application/pdf')).toBe(true);
    expect(accept.includes('image/')).toBe(true);
    expect(fileInput.getAttribute('style')).toMatch(/display\s*:\s*none/);
  });
});
