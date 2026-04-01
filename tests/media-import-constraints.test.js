'use strict';

const { loadBrowserModule } = require('./utils');

describe('media import constraints', () => {
  let MAX_MEDIA_IMPORT_BYTES;
  let formatBinaryMegabytes;
  let validateMediaImportSize;

  beforeAll(() => {
    ({
      MAX_MEDIA_IMPORT_BYTES,
      formatBinaryMegabytes,
      validateMediaImportSize,
    } = loadBrowserModule('public/js/media-import-constraints.js', [
      'MAX_MEDIA_IMPORT_BYTES',
      'formatBinaryMegabytes',
      'validateMediaImportSize',
    ]));
  });

  test('formats binary megabytes for user-facing messages', () => {
    expect(formatBinaryMegabytes(5 * 1024 * 1024)).toBe('5 MiB');
    expect(formatBinaryMegabytes(512 * 1024)).toBe('0.5 MiB');
  });

  test('accepts files at or under the size cap', () => {
    expect(validateMediaImportSize({ size: MAX_MEDIA_IMPORT_BYTES })).toEqual({
      ok: true,
      maxBytes: MAX_MEDIA_IMPORT_BYTES,
      size: MAX_MEDIA_IMPORT_BYTES,
    });
  });

  test('rejects files above the size cap before base64 conversion', () => {
    const result = validateMediaImportSize({ size: MAX_MEDIA_IMPORT_BYTES + 1 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Maximum supported size is 5 MiB/);
    expect(result.maxBytes).toBe(MAX_MEDIA_IMPORT_BYTES);
  });

  test('rejects missing or invalid file sizes', () => {
    expect(validateMediaImportSize({})).toEqual({
      ok: false,
      error: 'Unable to determine file size.',
    });
  });
});
