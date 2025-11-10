/** @jest-environment jsdom */
'use strict';

const { loadDocument } = require('./utils');

describe('Create & Share affordances', () => {
  test('index exposes Create & Share CTA', async () => {
    const document = await loadDocument('public/index.html');
    const cta = document.getElementById('createShareCta');
    expect(cta).not.toBeNull();
    expect(cta.tagName).toBe('A');
    expect(cta.getAttribute('href')).toBe('/create');
    expect(cta.textContent.trim()).toMatch(/Create/);
  });

  test('create page ships share controls behind beta gate', async () => {
    const document = await loadDocument('public/create.html');
    const shareControls = document.getElementById('shareControls');
    expect(shareControls).not.toBeNull();
    expect(shareControls.hasAttribute('hidden')).toBe(true);
    expect(shareControls.getAttribute('aria-hidden')).toBe('true');
    const shareBtn = document.getElementById('shareQuizBtn');
    expect(shareBtn).not.toBeNull();
    expect(shareBtn.classList.contains('hidden')).toBe(true);
    const shareLink = document.getElementById('shareLink');
    expect(shareLink).not.toBeNull();
    expect(shareLink.classList.contains('hidden')).toBe(true);
  });
});
