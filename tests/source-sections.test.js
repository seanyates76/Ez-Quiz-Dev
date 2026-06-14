'use strict';

const { loadBrowserModule } = require('./utils');

describe('source section visibility', () => {
  let analyzeSourceText;
  let formatSourceSectionSummary;
  let summarizeSourceReport;

  beforeAll(() => {
    ({ analyzeSourceText, formatSourceSectionSummary, summarizeSourceReport } = loadBrowserModule('public/js/source-sections.js', [
      'analyzeSourceText',
      'formatSourceSectionSummary',
      'summarizeSourceReport',
    ]));
  });

  test('Markdown headings produce sections with preserved heading paths', () => {
    const report = analyzeSourceText([
      '# Networking',
      'Networks move data between hosts because each layer has a job.',
      '',
      '## IPv4',
      '- Address: a 32-bit host identifier.',
      '- Mask: defines the network portion.',
      '',
      '### Subnets',
      'Subnetting means splitting a larger network into smaller networks.',
    ].join('\n'));

    expect(report.flags).toContain('heading-based');
    expect(report.sections.map((section) => section.heading)).toEqual(['Networking', 'IPv4', 'Subnets']);
    expect(report.sections[0]).toMatchObject({
      headingPath: ['Networking'],
      level: 1,
      sectionType: 'heading',
    });
    expect(report.sections[1].headingPath).toEqual(['Networking', 'IPv4']);
    expect(report.sections[2].headingPath).toEqual(['Networking', 'IPv4', 'Subnets']);
  });

  test('plain text without headings falls back to safe chunks', () => {
    const paragraphs = Array.from({ length: 8 }, (_, index) => (
      `Concept ${index + 1}: this paragraph explains a study point with a definition, an example, and a practical consequence for review.`
    ));
    const report = analyzeSourceText(paragraphs.join('\n\n'), {
      minSectionChars: 140,
      maxSectionChars: 360,
    });

    expect(report.flags).toContain('fallback-chunked');
    expect(report.sectionCount).toBeGreaterThan(1);
    expect(report.sections.every((section) => section.sectionType === 'fallback')).toBe(true);
    expect(report.sections.every((section) => section.headingPath.length === 0)).toBe(true);
    expect(report.sections.every((section) => section.charCount <= 360)).toBe(true);
  });

  test('short, empty, and placeholder sections are flagged weak', () => {
    const report = analyzeSourceText([
      '# Empty Section',
      '',
      '## Placeholder',
      'Notes coming soon.',
      '',
      '## Thin',
      'Home Next Menu',
    ].join('\n'));

    const empty = report.sections.find((section) => section.heading === 'Empty Section');
    const placeholder = report.sections.find((section) => section.heading === 'Placeholder');
    const thin = report.sections.find((section) => section.heading === 'Thin');

    expect(empty.flags).toEqual(expect.arrayContaining(['empty', 'weak']));
    expect(placeholder.flags).toEqual(expect.arrayContaining(['placeholder', 'weak']));
    expect(thin.flags).toEqual(expect.arrayContaining(['too-short', 'weak']));
    expect(report.weakCount).toBe(3);
  });

  test('bullet-heavy factual sections score higher than low-information text', () => {
    const bulletReport = analyzeSourceText([
      '# Useful Notes',
      '- Term A: first definition with a concrete explanation.',
      '- Term B: second definition with a concrete explanation.',
      '- Step 1: inspect the input before changing behavior.',
      '- Step 2: compare the result with expected output.',
      '- Important rule: validate the final state.',
    ].join('\n'));
    const weakReport = analyzeSourceText('# Low Signal\nWelcome. Click next.');

    expect(bulletReport.sections[0].bulletCount).toBe(5);
    expect(bulletReport.sections[0].score).toBeGreaterThan(weakReport.sections[0].score);
    expect(bulletReport.sections[0].reasons).toEqual(expect.arrayContaining(['bullet-heavy', 'definitions']));
    expect(weakReport.sections[0].flags).toContain('weak');
  });

  test('code blocks are counted and attached to the current heading section', () => {
    const report = analyzeSourceText([
      '# Setup',
      'Use the command below to install dependencies.',
      '',
      '```bash',
      'npm install',
      'npm test',
      '```',
      '',
      '## Review',
      'Confirm the result after the command completes.',
    ].join('\n'));

    const setup = report.sections.find((section) => section.heading === 'Setup');
    const review = report.sections.find((section) => section.heading === 'Review');

    expect(setup.codeBlockCount).toBe(1);
    expect(setup.commandSignal).toBe(true);
    expect(setup.reasons).toEqual(expect.arrayContaining(['commands', 'code-blocks']));
    expect(review.codeBlockCount).toBe(0);
  });

  test('large heading sections split safely without losing the heading path', () => {
    const text = Array.from({ length: 14 }, (_, index) => (
      `Paragraph ${index + 1}: this section explains a distinct factual point, why it matters, and how the learner should compare it with the previous point.`
    )).join('\n\n');
    const report = analyzeSourceText(`# Long Topic\n${text}`, {
      minSectionChars: 160,
      maxSectionChars: 520,
    });

    expect(report.sectionCount).toBeGreaterThan(1);
    expect(report.sections.every((section) => section.heading === 'Long Topic')).toBe(true);
    expect(report.sections.every((section) => section.headingPath.join('>') === 'Long Topic')).toBe(true);
    expect(report.sections.every((section) => section.flags.includes('split-large-section'))).toBe(true);
    expect(report.sections.every((section) => section.charCount <= 520)).toBe(true);
    expect(new Set(report.sections.map((section) => section.partCount)).size).toBe(1);
  });

  test('source-section report and section shapes are stable', () => {
    const report = analyzeSourceText([
      '# Terms',
      'API: application programming interface used by software systems to exchange requests and responses.',
      'CLI: command line interface used to run repeatable commands during setup and verification.',
      'Each term has a concrete explanation because learners need to connect vocabulary with use.',
    ].join('\n'));
    const section = report.sections[0];

    expect(Object.keys(report)).toEqual([
      'version',
      'sourceCharCount',
      'sourceLineCount',
      'sectionCount',
      'quizWorthyCount',
      'weakCount',
      'largestSectionId',
      'largestSectionHeading',
      'largestSectionCharCount',
      'detectedSignals',
      'flags',
      'sections',
    ]);
    expect(Object.keys(section)).toEqual([
      'id',
      'heading',
      'headingPath',
      'level',
      'sectionType',
      'partIndex',
      'partCount',
      'text',
      'preview',
      'charCount',
      'lineCount',
      'bulletCount',
      'codeBlockCount',
      'listCount',
      'definitionSignal',
      'termSignal',
      'commandSignal',
      'score',
      'reasons',
      'flags',
    ]);
    expect(section).toMatchObject({
      id: 'section-001',
      heading: 'Terms',
      headingPath: ['Terms'],
      level: 1,
      definitionSignal: true,
      termSignal: true,
    });
    expect(formatSourceSectionSummary(report)).toMatch(/1 section, 1 quiz-worthy/);
    expect(summarizeSourceReport(report)).toMatchObject({
      sectionCount: 1,
      quizWorthyCount: 1,
      weakCount: 0,
    });
  });
});
