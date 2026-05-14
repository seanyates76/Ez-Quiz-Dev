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
    expect(importBtn.getAttribute('title')).toMatch(/Attach notes or documents/);
    expect(importBtn.getAttribute('aria-label')).toMatch(/Attach notes or documents/);
  });

  test('file input accepts source documents, pdfs, images, and stays hidden', () => {
    const fileInput = document.getElementById('importFile');
    expect(fileInput).not.toBeNull();
    expect(fileInput.getAttribute('type')).toBe('file');

    const accept = fileInput.getAttribute('accept') || '';
    expect(accept.includes('application/pdf')).toBe(true);
    expect(accept.includes('image/')).toBe(true);
    expect(accept.includes('.txt')).toBe(true);
    expect(accept.includes('.md')).toBe(true);
    expect(accept.includes('.html')).toBe(true);
    expect(accept.includes('.docx')).toBe(true);
    expect(fileInput.getAttribute('style')).toMatch(/display\s*:\s*none/);
  });
});
