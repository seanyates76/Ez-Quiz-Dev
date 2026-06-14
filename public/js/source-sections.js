const REPORT_VERSION = 1;
const DEFAULT_MIN_SECTION_CHARS = 260;
const DEFAULT_MAX_SECTION_CHARS = 3600;
const DEFAULT_PREVIEW_CHARS = 180;

function toPositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeSourceForAnalysis(raw) {
  return String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
}

function normalizeInlineText(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim();
}

function previewText(raw, limit) {
  const text = normalizeInlineText(raw);
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1)).trim()}...` : text;
}

function headingFromMarkdownLine(line) {
  const match = String(line || '').match(/^(#{1,6})[ \t]+(.+?)\s*#*\s*$/);
  if (!match) return null;
  const heading = normalizeInlineText(match[2].replace(/^#+\s*/, ''));
  if (!heading) return null;
  return { level: match[1].length, heading };
}

function isFenceLine(line) {
  return /^\s*(```+|~~~+)/.test(String(line || ''));
}

function textFromLines(lines) {
  return (lines || []).join('\n').trim();
}

function markdownCandidates(text) {
  const lines = String(text || '').split('\n');
  const candidates = [];
  const stack = [];
  let current = null;
  let inFence = false;
  let sawHeading = false;

  function ensurePreface() {
    if (!current) {
      current = {
        heading: 'Untitled',
        headingPath: [],
        level: null,
        sectionType: 'fallback',
        textLines: [],
        flags: ['preface'],
      };
    }
    return current;
  }

  function finishCurrent() {
    if (!current) return;
    candidates.push({
      heading: current.heading,
      headingPath: current.headingPath,
      level: current.level,
      sectionType: current.sectionType,
      text: textFromLines(current.textLines),
      flags: current.flags || [],
    });
    current = null;
  }

  for (const line of lines) {
    const fence = isFenceLine(line);
    if (!inFence && !fence) {
      const heading = headingFromMarkdownLine(line);
      if (heading) {
        sawHeading = true;
        finishCurrent();
        while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop();
        stack.push({ level: heading.level, heading: heading.heading });
        current = {
          heading: heading.heading,
          headingPath: stack.map((entry) => entry.heading),
          level: heading.level,
          sectionType: 'heading',
          textLines: [],
          flags: [],
        };
        continue;
      }
    }

    if (fence) inFence = !inFence;
    if (line.trim() || current) ensurePreface().textLines.push(line);
  }

  finishCurrent();
  return sawHeading ? candidates : [];
}

function cutBoundary(windowText, minChars, maxChars) {
  const minUsefulCut = Math.max(80, Math.min(minChars, Math.floor(maxChars * 0.55)));
  const paragraphCut = windowText.lastIndexOf('\n\n');
  if (paragraphCut >= minUsefulCut) return paragraphCut;
  const newlineCut = windowText.lastIndexOf('\n');
  if (newlineCut >= minUsefulCut) return newlineCut;
  const sentenceCut = Math.max(
    windowText.lastIndexOf('. '),
    windowText.lastIndexOf('? '),
    windowText.lastIndexOf('! '),
    windowText.lastIndexOf('; '),
    windowText.lastIndexOf(': ')
  );
  if (sentenceCut >= minUsefulCut) return sentenceCut + 1;
  const spaceCut = windowText.lastIndexOf(' ');
  if (spaceCut >= minUsefulCut) return spaceCut;
  return maxChars;
}

function splitLongText(raw, maxChars, minChars) {
  let remaining = String(raw || '').trim();
  if (!remaining) return [];
  const chunks = [];
  while (remaining.length > maxChars) {
    const windowText = remaining.slice(0, maxChars);
    const cut = cutBoundary(windowText, minChars, maxChars);
    const chunk = remaining.slice(0, cut).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function splitTextSafely(raw, maxChars, minChars) {
  const text = String(raw || '').trim();
  if (!text) return [''];
  if (text.length <= maxChars) return [text];

  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  if (blocks.length <= 1) return splitLongText(text, maxChars, minChars);

  const chunks = [];
  let current = '';
  const flushCurrent = () => {
    if (!current.trim()) return;
    chunks.push(current.trim());
    current = '';
  };

  for (const block of blocks) {
    if (block.length > maxChars) {
      flushCurrent();
      chunks.push(...splitLongText(block, maxChars, minChars));
      continue;
    }
    if (!current) {
      current = block;
      continue;
    }
    const next = `${current}\n\n${block}`;
    if (next.length <= maxChars || current.length < minChars) {
      current = next;
      continue;
    }
    flushCurrent();
    current = block;
  }
  flushCurrent();

  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1];
    const prev = chunks[chunks.length - 2];
    if (last.length < minChars && `${prev}\n\n${last}`.length <= maxChars) {
      chunks.splice(chunks.length - 2, 2, `${prev}\n\n${last}`);
    }
  }

  return chunks.length ? chunks : [text];
}

function fallbackCandidates(text, options) {
  const chunks = splitTextSafely(text, options.maxSectionChars, options.minSectionChars);
  return chunks.map((chunk, index) => ({
    heading: `Section ${index + 1}`,
    headingPath: [],
    level: null,
    sectionType: 'fallback',
    text: chunk,
    flags: ['fallback'],
  }));
}

function splitCandidate(candidate, options) {
  const text = String(candidate.text || '').trim();
  if (!text || text.length <= options.maxSectionChars) {
    return [{ ...candidate, partIndex: 1, partCount: 1 }];
  }
  const chunks = splitTextSafely(text, options.maxSectionChars, options.minSectionChars);
  return chunks.map((chunk, index) => ({
    ...candidate,
    text: chunk,
    partIndex: index + 1,
    partCount: chunks.length,
    flags: Array.from(new Set([...(candidate.flags || []), 'split-large-section'])),
  }));
}

function isBulletLine(line) {
  return /^\s*(?:[-*+]|\u2022)\s+\S/.test(String(line || ''));
}

function isNumberedListLine(line) {
  return /^\s*(?:\d+|[A-Za-z])[.)]\s+\S/.test(String(line || ''));
}

function isListLine(line) {
  return isBulletLine(line) || isNumberedListLine(line);
}

function stripListPrefix(line) {
  return String(line || '')
    .trim()
    .replace(/^(?:[-*+]|\u2022)\s+/, '')
    .replace(/^(?:\d+|[A-Za-z])[.)]\s+/, '')
    .trim();
}

function listGroupCount(lines) {
  let count = 0;
  let inList = false;
  for (const line of lines) {
    if (isListLine(line)) {
      if (!inList) count += 1;
      inList = true;
    } else if (!line.trim()) {
      inList = false;
    } else {
      inList = false;
    }
  }
  return count;
}

function countCodeBlocks(text) {
  const lines = String(text || '').split('\n');
  let inFence = false;
  let count = 0;
  for (const line of lines) {
    if (!isFenceLine(line)) continue;
    if (!inFence) count += 1;
    inFence = !inFence;
  }
  return count;
}

function definitionMatchCount(lines, text) {
  const lineMatches = lines.filter((line) => {
    const raw = stripListPrefix(line);
    if (!raw || raw.length > 180) return false;
    return /^[A-Za-z][^:\n]{1,80}:\s+\S/.test(raw)
      || /^[A-Za-z][A-Za-z0-9 /+.#()_-]{1,80}\s+-\s+\S/.test(raw);
  }).length;
  const proseMatches = (String(text || '').match(/\b(?:means|refers to|is defined as|are defined as|is a|is an|are a|are an)\b/gi) || []).length;
  return lineMatches + proseMatches;
}

function termMatchCount(lines) {
  return lines.filter((line) => {
    const raw = stripListPrefix(line);
    if (!raw || raw.length > 160) return false;
    return /^[A-Z][A-Za-z0-9 /+.#()_-]{1,80}\s*(?::|-)\s+\S/.test(raw);
  }).length;
}

function commandMatchCount(lines, codeBlockCount) {
  const commandLines = lines.filter((line) => {
    const raw = String(line || '').trim();
    if (!raw) return false;
    return /^(?:[$>#]\s*)?(?:git|npm|node|python3?|curl|ssh|scp|docker|kubectl|netlify|deno|pnpm|yarn|ping|traceroute|ipconfig|ifconfig|show|configure)\b/i.test(raw);
  }).length;
  return commandLines + codeBlockCount;
}

function hasCauseEffect(text) {
  return /\b(?:because|therefore|so that|as a result|results in|causes|leads to|depends on|when|if)\b/i.test(String(text || ''));
}

function hasComparison(text) {
  return /\b(?:compared with|compared to|versus|vs\.?|unlike|whereas|while|difference between|similar to|more than|less than)\b/i.test(String(text || ''));
}

function importantKeywordCount(text) {
  return (String(text || '').match(/\b(?:important|key|must|should|remember|exam|warning|note|rule|step|process|requirement|definition)\b/gi) || []).length;
}

function placeholderFlags(text, charCount) {
  const flags = [];
  const compact = normalizeInlineText(text).toLowerCase();
  if (!compact) flags.push('empty');
  if (charCount > 0 && charCount < 80) flags.push('too-short');
  if (/\b(?:coming soon|no cleaned notes yet|todo|tbd|placeholder|lorem ipsum|under construction|not available|to be added)\b/i.test(compact)) {
    flags.push('placeholder');
  }
  if (/\b(?:home|previous|next|table of contents|copyright|all rights reserved|privacy policy|terms of service|subscribe|sign in|menu)\b/i.test(compact)
    && charCount < 500) {
    flags.push('boilerplate');
  }
  const words = compact.split(/\s+/).filter(Boolean);
  const unique = new Set(words.map((word) => word.replace(/[^a-z0-9-]/g, '')).filter(Boolean));
  if (charCount >= 80 && words.length >= 20 && unique.size / words.length < 0.35) flags.push('repetitive');
  if (charCount >= 80 && words.length < 18) flags.push('low-information');
  return flags;
}

function scoreSection({ heading, sectionType, text, charCount, bulletCount, codeBlockCount, listCount, definitionSignal, termSignal, commandSignal }) {
  const reasons = [];
  const flags = placeholderFlags(text, charCount);
  let score = 0;

  if (sectionType === 'heading' && heading) {
    score += 8;
    reasons.push('heading');
  }
  if (charCount >= 120) {
    score += 12;
    reasons.push('enough-text');
  }
  if (charCount >= 400) {
    score += 10;
    reasons.push('substantial-text');
  }
  if (charCount >= 1200) {
    score += 6;
    reasons.push('deep-section');
  }
  if (bulletCount >= 3) {
    score += 15;
    reasons.push('bullet-heavy');
  }
  if (bulletCount >= 8) {
    score += 8;
    reasons.push('many-bullets');
  }
  if (listCount >= 2) {
    score += 8;
    reasons.push('multiple-lists');
  }
  if (definitionSignal) {
    score += 18;
    reasons.push('definitions');
  }
  if (termSignal) {
    score += 10;
    reasons.push('terms');
  }
  if (commandSignal) {
    score += 12;
    reasons.push('commands');
  }
  if (codeBlockCount > 0) {
    score += 8;
    reasons.push('code-blocks');
  }
  if (hasCauseEffect(text)) {
    score += 6;
    reasons.push('cause-effect');
  }
  if (hasComparison(text)) {
    score += 6;
    reasons.push('comparison');
  }
  if (importantKeywordCount(text) >= 2) {
    score += 5;
    reasons.push('important-keywords');
  }

  if (flags.includes('empty')) score -= 45;
  if (flags.includes('too-short')) score -= 22;
  if (flags.includes('placeholder')) score -= 35;
  if (flags.includes('boilerplate')) score -= 18;
  if (flags.includes('repetitive')) score -= 12;
  if (flags.includes('low-information')) score -= 12;

  score = Math.max(0, Math.min(100, Math.round(score)));
  if (score < 30 || flags.includes('empty') || flags.includes('placeholder') || flags.includes('boilerplate')) {
    flags.push('weak');
  }

  return {
    score,
    reasons: Array.from(new Set(reasons)),
    flags: Array.from(new Set(flags)),
  };
}

function buildSection(candidate, index, options) {
  const text = String(candidate.text || '').trim();
  const lines = text ? text.split('\n') : [];
  const nonEmptyLines = lines.filter((line) => line.trim());
  const bulletCount = lines.filter(isBulletLine).length;
  const codeBlockCount = countCodeBlocks(text);
  const listCount = listGroupCount(lines);
  const definitionSignal = definitionMatchCount(lines, text) > 0;
  const termSignal = termMatchCount(lines) > 0;
  const commandSignal = commandMatchCount(lines, codeBlockCount) > 0;
  const charCount = text.length;
  const scored = scoreSection({
    heading: candidate.heading,
    sectionType: candidate.sectionType,
    text,
    charCount,
    bulletCount,
    codeBlockCount,
    listCount,
    definitionSignal,
    termSignal,
    commandSignal,
  });
  const flags = Array.from(new Set([...(candidate.flags || []), ...scored.flags]));
  return {
    id: `section-${String(index + 1).padStart(3, '0')}`,
    heading: candidate.heading || `Section ${index + 1}`,
    headingPath: Array.isArray(candidate.headingPath) ? candidate.headingPath.slice() : [],
    level: Number.isFinite(candidate.level) ? candidate.level : null,
    sectionType: candidate.sectionType || 'fallback',
    partIndex: candidate.partIndex || 1,
    partCount: candidate.partCount || 1,
    text,
    preview: previewText(text, options.previewChars),
    charCount,
    lineCount: nonEmptyLines.length,
    bulletCount,
    codeBlockCount,
    listCount,
    definitionSignal,
    termSignal,
    commandSignal,
    score: scored.score,
    reasons: scored.reasons,
    flags,
  };
}

function detectedSignalsFromSections(sections) {
  const signals = [];
  if (sections.some((section) => section.definitionSignal)) signals.push('definitions');
  if (sections.some((section) => section.termSignal)) signals.push('terms');
  if (sections.some((section) => section.commandSignal)) signals.push('commands');
  if (sections.some((section) => section.codeBlockCount > 0)) signals.push('code-blocks');
  if (sections.some((section) => section.listCount > 0)) signals.push('lists');
  if (sections.some((section) => section.bulletCount >= 3)) signals.push('bullet-heavy');
  if (sections.some((section) => section.reasons.includes('cause-effect'))) signals.push('cause-effect');
  if (sections.some((section) => section.reasons.includes('comparison'))) signals.push('comparisons');
  return signals;
}

export function analyzeSourceText(raw, options = {}) {
  const normalized = normalizeSourceForAnalysis(raw);
  const opts = {
    minSectionChars: Math.max(80, toPositiveInt(options.minSectionChars, DEFAULT_MIN_SECTION_CHARS)),
    maxSectionChars: Math.max(180, toPositiveInt(options.maxSectionChars, DEFAULT_MAX_SECTION_CHARS)),
    previewChars: Math.max(80, toPositiveInt(options.previewChars, DEFAULT_PREVIEW_CHARS)),
  };
  if (opts.maxSectionChars < opts.minSectionChars) opts.minSectionChars = Math.floor(opts.maxSectionChars * 0.5);

  const report = {
    version: REPORT_VERSION,
    sourceCharCount: normalized.length,
    sourceLineCount: normalized ? normalized.split('\n').length : 0,
    sectionCount: 0,
    quizWorthyCount: 0,
    weakCount: 0,
    largestSectionId: '',
    largestSectionHeading: '',
    largestSectionCharCount: 0,
    detectedSignals: [],
    flags: [],
    sections: [],
  };

  if (!normalized) {
    report.flags.push('empty-source');
    return report;
  }

  const headingBased = markdownCandidates(normalized);
  const baseCandidates = headingBased.length ? headingBased : fallbackCandidates(normalized, opts);
  const splitCandidates = baseCandidates.flatMap((candidate) => splitCandidate(candidate, opts));
  const sections = splitCandidates.map((candidate, index) => buildSection(candidate, index, opts));

  report.sections = sections;
  report.sectionCount = sections.length;
  report.weakCount = sections.filter((section) => section.flags.includes('weak')).length;
  report.quizWorthyCount = sections.filter((section) => section.score >= 45 && !section.flags.includes('weak')).length;
  const largest = sections.reduce((best, section) => (section.charCount > (best && best.charCount || 0) ? section : best), null);
  if (largest) {
    report.largestSectionId = largest.id;
    report.largestSectionHeading = largest.heading;
    report.largestSectionCharCount = largest.charCount;
  }
  report.detectedSignals = detectedSignalsFromSections(sections);
  if (headingBased.length) report.flags.push('heading-based');
  else report.flags.push('fallback-chunked');
  if (report.weakCount) report.flags.push('has-weak-sections');
  return report;
}

export function summarizeSourceReport(report = {}) {
  const sections = Array.isArray(report.sections) ? report.sections : [];
  const sectionCount = Number.isFinite(report.sectionCount) ? report.sectionCount : sections.length;
  const quizWorthyCount = Number.isFinite(report.quizWorthyCount)
    ? report.quizWorthyCount
    : sections.filter((section) => section.score >= 45 && !(section.flags || []).includes('weak')).length;
  const weakCount = Number.isFinite(report.weakCount)
    ? report.weakCount
    : sections.filter((section) => (section.flags || []).includes('weak')).length;
  return {
    sectionCount,
    quizWorthyCount,
    weakCount,
    largestSectionId: report.largestSectionId || '',
    largestSectionHeading: report.largestSectionHeading || '',
    largestSectionCharCount: Number(report.largestSectionCharCount || 0),
    detectedSignals: Array.isArray(report.detectedSignals) ? report.detectedSignals.slice() : [],
  };
}

export function formatSourceSectionSummary(report = {}) {
  const summary = summarizeSourceReport(report);
  if (!summary.sectionCount) return '';
  const sectionLabel = summary.sectionCount === 1 ? 'section' : 'sections';
  const parts = [
    `${summary.sectionCount.toLocaleString()} ${sectionLabel}`,
    `${summary.quizWorthyCount.toLocaleString()} quiz-worthy`,
  ];
  if (summary.weakCount) parts.push(`${summary.weakCount.toLocaleString()} weak`);
  if (summary.largestSectionCharCount) parts.push(`largest ${summary.largestSectionCharCount.toLocaleString()} chars`);
  return parts.join(', ');
}
