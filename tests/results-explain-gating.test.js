/** @jest-environment jsdom */

'use strict';

const { readFile } = require('./utils');

function loadSyncExplainButtonsVisibility() {
  const source = readFile('public/js/quiz.js')
    .replace(/^import .*$/gm, '')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+let\s+/g, 'let ')
    .replace(/export\s+var\s+/g, 'var ');

  const factory = new Function(
    'S',
    'isBetaEnabled',
    'document',
    `${source}\nreturn { syncExplainButtonsVisibility };`
  );

  const S = { settings: { betaEnabled: false } };
  const isBetaEnabled = (settings) => !!settings?.betaEnabled || document.body?.hasAttribute?.('data-beta');
  return { S, ...factory(S, isBetaEnabled, document) };
}

describe('results explain button gating cleanup', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.removeAttribute('data-beta');
  });

  test('removes stale explain buttons when beta is disabled', () => {
    const { S, syncExplainButtonsVisibility } = loadSyncExplainButtonsVisibility();
    S.settings.betaEnabled = false;
    document.body.innerHTML = `
      <div id="resultsView">
        <div id="missedList">
          <div class="missed-item">
            <div class="res-head">
              <button type="button" class="chip-btn explain-btn" data-explain="0">Explain</button>
            </div>
          </div>
        </div>
      </div>
    `;

    syncExplainButtonsVisibility();

    expect(document.querySelector('.explain-btn')).toBeNull();
  });

  test('keeps explain buttons when beta is enabled', () => {
    const { S, syncExplainButtonsVisibility } = loadSyncExplainButtonsVisibility();
    S.settings.betaEnabled = true;
    document.body.innerHTML = `
      <div id="resultsView">
        <div id="missedList">
          <button type="button" class="chip-btn explain-btn" data-explain="0">Explain</button>
        </div>
      </div>
    `;

    syncExplainButtonsVisibility();

    expect(document.querySelector('.explain-btn')).not.toBeNull();
  });
});
