'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
// Polyfill encoders for jsdom/whatwg-url under Jest when missing
try {
  const u = require('node:util');
  if (typeof global.TextEncoder === 'undefined' && u.TextEncoder) global.TextEncoder = u.TextEncoder;
  if (typeof global.TextDecoder === 'undefined' && u.TextDecoder) global.TextDecoder = u.TextDecoder;
} catch {}
let jsdomModulePromise;

async function getJsdomModule() {
  if (!jsdomModulePromise) {
    const jsdomPath = require.resolve('jsdom');
    jsdomModulePromise = import(pathToFileURL(jsdomPath));
  }

  return jsdomModulePromise;
}

const ROOT_DIR = path.resolve(__dirname, '..');

function resolve(relPath) {
  return path.resolve(ROOT_DIR, relPath);
}

function readFile(relPath) {
  return fs.readFileSync(resolve(relPath), 'utf8');
}

function loadBrowserModule(relPath, namedExports) {
  if (!Array.isArray(namedExports) || namedExports.length === 0) {
    throw new Error('namedExports must be a non-empty array');
  }
  const absPath = resolve(relPath);
  const source = readFile(relPath)
    .replace(/export\s+class\s+/g, 'class ')
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+let\s+/g, 'let ')
    .replace(/export\s+var\s+/g, 'var ');
  // Evaluate in the current context so browser globals like Blob remain available.
  const factory = new Function(`${source}\nreturn { ${namedExports.join(', ')} };\n//# sourceURL=${absPath}`);
  return factory();
}

async function loadDocument(relPath) {
  const html = readFile(relPath);
  // Prefer global DOM when test env is jsdom to avoid ESM/CJS parse5 issues
  try {
    if (typeof window !== 'undefined' && window) {
      if (typeof window.DOMParser === 'function') {
        const parser = new window.DOMParser();
        return parser.parseFromString(html, 'text/html');
      }
      // jsdom env present but no DOMParser: write into existing document
      if (window.document && typeof window.document.open === 'function') {
        const doc = window.document;
        doc.open();
        doc.write(html);
        doc.close();
        return doc;
      }
    }
  } catch {}
  // Create a detached HTMLDocument when no parser API present but window exists
  if (typeof window !== 'undefined' && window && window.document && window.document.implementation) {
    try {
      const doc = window.document.implementation.createHTMLDocument('');
      doc.documentElement.innerHTML = html;
      return doc;
    } catch {}
  }
  throw new Error('No DOM environment available for loadDocument');
}

module.exports = {
  readFile,
  loadBrowserModule,
  loadDocument,
};
