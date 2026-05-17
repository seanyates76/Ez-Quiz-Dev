'use strict';

const MAX_SOURCE_TEXT_CHARS = 30000;

function cleanSourceText(raw) {
  return String(raw || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_SOURCE_TEXT_CHARS);
}

module.exports = {
  MAX_SOURCE_TEXT_CHARS,
  cleanSourceText,
};
