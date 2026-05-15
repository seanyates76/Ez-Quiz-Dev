/** @jest-environment jsdom */
'use strict';

const { loadDocument } = require('./utils');

describe('Media Input UI', () => {
  let document;

  beforeAll(async () => {
    document = await loadDocument('public/index.html');
  });

  test('has public import button with accessible labeling', () => {
    const importBtn = document.getElementById('importBtn');
    expect(importBtn).not.toBeNull();
    expect(importBtn.classList.contains('beta-only')).toBe(false);
    expect(importBtn.getAttribute('title')).toMatch(/Attach notes or documents/);
    expect(importBtn.getAttribute('aria-label')).toMatch(/Attach notes or documents/);
    expect(importBtn.getAttribute('title')).not.toMatch(/beta/i);
    expect(importBtn.getAttribute('aria-label')).not.toMatch(/beta/i);
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
