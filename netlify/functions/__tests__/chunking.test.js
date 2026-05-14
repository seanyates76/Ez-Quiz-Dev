const { generateInBatches } = require('../lib/providers.js');

jest.mock('../lib/normalizer.js', () => ({
  normalizeLegacyLines: jest.fn(),
}));

const { normalizeLegacyLines } = require('../lib/normalizer.js');

afterEach(() => {
  jest.resetAllMocks();
});

describe('generateInBatches', () => {
  test('trims to requested count, keeps first metadata, and skips duplicate stems across passes', async () => {
    normalizeLegacyLines
      .mockImplementationOnce(() => ({
        title: 'First Title',
        lines: [
          'MC|Alpha stem?|A) 1;B) 2;C) 3;D) 4|A',
          'MC|Beta stem?|A) 1;B) 2;C) 3;D) 4|B',
          'MC|Gamma stem?|A) 1;B) 2;C) 3;D) 4|C',
        ].join('\n'),
      }))
      .mockImplementationOnce(() => ({
        title: 'Second Title',
        lines: [
          'MC|Alpha stem?|A) 1;B) 2;C) 3;D) 4|A',
          'MC|Delta stem?|A) 1;B) 2;C) 3;D) 4|D',
          'MC|Epsilon stem?|A) 1;B) 2;C) 3;D) 4|A',
        ].join('\n'),
      }));

    const result = await generateInBatches({
      provider: 'echo',
      topic: 'Chunked Topic',
      count: 4,
      batchSize: 3,
      maxPasses: 3,
    });

    expect(normalizeLegacyLines).toHaveBeenCalledTimes(2);
    expect(result.title).toBe('First Title');
    expect(result.provider).toBe('echo');
    expect(result.model).toBe('echo');

    const lines = result.lines.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines).toEqual([
      'MC|Alpha stem?|A) 1;B) 2;C) 3;D) 4|A',
      'MC|Beta stem?|A) 1;B) 2;C) 3;D) 4|B',
      'MC|Gamma stem?|A) 1;B) 2;C) 3;D) 4|C',
      'MC|Delta stem?|A) 1;B) 2;C) 3;D) 4|D',
    ]);
    expect(new Set(lines).size).toBe(4);
  });

  test('returns collected unique lines even when duplicates exhaust available input', async () => {
    normalizeLegacyLines
      .mockImplementationOnce(() => ({
        title: 'Sparse Batch',
        lines: [
          'MC|Alpha stem?|A) 1;B) 2;C) 3;D) 4|A',
          'MC|Beta stem?|A) 1;B) 2;C) 3;D) 4|B',
        ].join('\n'),
      }))
      .mockImplementationOnce(() => ({
        title: 'Sparse Batch',
        lines: [
          'MC|Alpha stem?|A) 1;B) 2;C) 3;D) 4|A',
        ].join('\n'),
      }))
      .mockImplementationOnce(() => ({
        title: 'Sparse Batch',
        lines: [
          'MC|Beta stem?|A) 1;B) 2;C) 3;D) 4|B',
        ].join('\n'),
      }));

    const result = await generateInBatches({
      provider: 'echo',
      topic: 'Chunked Topic',
      count: 5,
      batchSize: 2,
      maxPasses: 3,
    });

    expect(normalizeLegacyLines).toHaveBeenCalledTimes(3);
    expect(result.title).toBe('Sparse Batch');
    expect(result.provider).toBe('echo');
    expect(result.model).toBe('echo');

    const lines = result.lines.split('\n');
    expect(lines).toHaveLength(2);
    expect(new Set(lines).size).toBe(2);
  });

  test('de-duplicates stems ignoring trivial whitespace/punctuation', async () => {
    normalizeLegacyLines
      .mockImplementationOnce(() => ({
        title: 'Stem Variants',
        lines: [
          'MC|Alpha stem?|A) 1;B) 2|A',
          'MC|Beta stem?|A) 1;B) 2|B',
        ].join('\n'),
      }))
      .mockImplementationOnce(() => ({
        title: 'Stem Variants',
        lines: [
          'MC|Alpha stem ?|A) 1;B) 2|A',
          'MC|Gamma stem?|A) 1;B) 2|B',
        ].join('\n'),
      }));

    const result = await generateInBatches({
      provider: 'echo',
      topic: 'Topic',
      count: 3,
      batchSize: 2,
      maxPasses: 2,
    });

    const lines = result.lines.split('\n');
    expect(new Set(lines).size).toBe(lines.length);
    expect(lines).toContain('MC|Gamma stem?|A) 1;B) 2|B');
  });
});
