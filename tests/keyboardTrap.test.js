'use strict';

// Minimal harness to verify Escape cancels drag-active and restores focus

function setupAffix() {
  document.body.innerHTML = `
    <input id="topicInput" />
    <button id="importBtn">Attach</button>
    <div class="topic-affix" id="affix" tabindex="0"></div>
  `;
  const topicInput = document.getElementById('topicInput');
  const importBtn = document.getElementById('importBtn');
  const topicAffix = document.getElementById('affix');

  // emulate generator's behavior: dragenter starts drag-active and installs Escape handler
  const focusAffixExitTarget = () => {
    if (topicInput && typeof topicInput.focus === 'function') {
      topicInput.focus();
      return;
    }
    importBtn.focus();
  };
  const esc = (evt) => {
    if (evt.key === 'Escape' || evt.key === 'Esc') {
      evt.preventDefault();
      evt.stopPropagation();
      topicAffix.classList.remove('drag-active');
      topicAffix.classList.remove('drag-on');
      focusAffixExitTarget();
      document.removeEventListener('keydown', esc, { capture: true });
    }
  };
  topicAffix.addEventListener('dragenter', () => {
    topicAffix.classList.add('drag-active');
    topicAffix.classList.add('drag-on');
    document.addEventListener('keydown', esc, { capture: true });
  });
  topicAffix.addEventListener('dragleave', () => {
    topicAffix.classList.remove('drag-active');
    topicAffix.classList.remove('drag-on');
    document.removeEventListener('keydown', esc, { capture: true });
  });

  return { topicInput, importBtn, topicAffix };
}

test('Escape cancels drag-active and restores focus to the topic input', () => {
  const { topicInput, topicAffix } = setupAffix();
  topicAffix.dispatchEvent(new Event('dragenter', { bubbles: true }));
  expect(topicAffix.classList.contains('drag-active')).toBe(true);
  const keyEvt = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.dispatchEvent(keyEvt);
  expect(topicAffix.classList.contains('drag-active')).toBe(false);
  expect(document.activeElement).toBe(topicInput);
  expect(keyEvt.defaultPrevented).toBe(true);
});

