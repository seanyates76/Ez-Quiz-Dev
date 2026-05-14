'use strict';
const { Blob: NodeBlob } = require('buffer');

const { loadBrowserModule } = require('./utils');

describe('file type validation', () => {
  let sniffFileKind;
  let getImportKindFromMime;
  let getImportKindFromName;
  let hasImportMetadataMismatch;
  let isSupportedImportKind;

  beforeAll(() => {
    ({
      sniffFileKind,
      getImportKindFromMime,
      getImportKindFromName,
      hasImportMetadataMismatch,
      isSupportedImportKind,
    } = loadBrowserModule('public/js/file-type-validation.js', [
      'sniffFileKind',
      'getImportKindFromMime',
      'getImportKindFromName',
      'hasImportMetadataMismatch',
      'isSupportedImportKind',
    ]));
  });

  const fromHex = (hex) => {
    const pairs = hex.match(/.{1,2}/g) || [];
    return Uint8Array.from(pairs.map((pair) => parseInt(pair, 16)));
  };

  const makeBlob = (hex, attrs = {}) => {
    const blob = new NodeBlob([fromHex(hex)], attrs);
    if (attrs && Object.prototype.hasOwnProperty.call(attrs, 'name')) {
      Object.defineProperty(blob, 'name', {
        value: attrs.name,
        configurable: true,
      });
    }
    return blob;
  };

  test('detects pdf headers', async () => {
    const blob = makeBlob('255044462d312e350a00'); // %PDF-1.5\n
    await expect(sniffFileKind(blob)).resolves.toBe('pdf');
  });

  test('detects png headers', async () => {
    const blob = makeBlob('89504e470d0a1a0a00');
    await expect(sniffFileKind(blob)).resolves.toBe('png');
  });

  test('detects jpeg headers', async () => {
    const blob = makeBlob('ffd8ffe000104a46494600');
    await expect(sniffFileKind(blob)).resolves.toBe('jpeg');
  });

  test('detects gif headers', async () => {
    const blob = makeBlob('47494638396126002600');
    await expect(sniffFileKind(blob)).resolves.toBe('gif');
  });

  test('returns unknown for unsupported bytes', async () => {
    const blob = makeBlob('0001020304050607');
    await expect(sniffFileKind(blob)).resolves.toBe('unknown');
  });

  test('maps supported MIME types to import kinds', () => {
    expect(getImportKindFromMime('application/pdf')).toBe('pdf');
    expect(getImportKindFromMime('image/jpeg')).toBe('jpeg');
    expect(getImportKindFromMime('image/jpg')).toBe('jpeg');
    expect(getImportKindFromMime('text/plain')).toBe('txt');
    expect(getImportKindFromMime('text/markdown')).toBe('md');
    expect(getImportKindFromMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx');
  });

  test('maps supported filename extensions to import kinds', () => {
    expect(getImportKindFromName('scan.PDF')).toBe('pdf');
    expect(getImportKindFromName('photo.jpeg')).toBe('jpeg');
    expect(getImportKindFromName('photo.jpg')).toBe('jpeg');
    expect(getImportKindFromName('notes.md')).toBe('md');
    expect(getImportKindFromName('outline.docx')).toBe('docx');
    expect(getImportKindFromName('archive.zip')).toBe('unknown');
  });

  test('detects text-ish files from metadata and readable bytes', async () => {
    const blob = new NodeBlob([Buffer.from('Photosynthesis\\nPlants make sugar.')], { type: 'text/plain' });
    Object.defineProperty(blob, 'name', { value: 'notes.txt', configurable: true });
    await expect(sniffFileKind(blob)).resolves.toBe('txt');
  });

  test('accepts utf-16 text files when metadata identifies text', async () => {
    const blob = new NodeBlob([Buffer.from([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00])], { type: 'text/plain' });
    Object.defineProperty(blob, 'name', { value: 'notes.txt', configurable: true });
    await expect(sniffFileKind(blob)).resolves.toBe('txt');
  });

  test('flags MIME mismatches against sniffed file bytes', () => {
    const blob = makeBlob('89504e470d0a1a0a00', { type: 'application/pdf', name: 'image.png' });
    expect(hasImportMetadataMismatch(blob, 'png')).toBe(true);
  });

  test('flags filename mismatches against sniffed file bytes', () => {
    const blob = makeBlob('ffd8ffe000104a46494600', { type: 'image/jpeg', name: 'not-a-pdf.pdf' });
    expect(hasImportMetadataMismatch(blob, 'jpeg')).toBe(true);
  });

  test('allows empty or matching metadata when bytes are supported', () => {
    const matchingBlob = makeBlob('255044462d312e350a00', { type: 'application/pdf', name: 'worksheet.pdf' });
    const unknownBlob = makeBlob('47494638396126002600', { type: '', name: '' });
    expect(hasImportMetadataMismatch(matchingBlob, 'pdf')).toBe(false);
    expect(hasImportMetadataMismatch(unknownBlob, 'gif')).toBe(false);
  });

  test('isSupportedImportKind flags supported values', () => {
    expect(isSupportedImportKind('pdf')).toBe(true);
    expect(isSupportedImportKind('png')).toBe(true);
    expect(isSupportedImportKind('jpeg')).toBe(true);
    expect(isSupportedImportKind('gif')).toBe(true);
    expect(isSupportedImportKind('txt')).toBe(true);
    expect(isSupportedImportKind('md')).toBe(true);
    expect(isSupportedImportKind('html')).toBe(true);
    expect(isSupportedImportKind('docx')).toBe(true);
    expect(isSupportedImportKind('bmp')).toBe(false);
  });
});
