'use strict';

const crypto = require('node:crypto');
const {
  DIFFICULTY_SCHEMA_DESCRIPTION,
  QUIZ_DIFFICULTIES,
} = require('./mcpQuizGuidance.js');

const MAX_QUESTIONS = 20;
const MAX_OPTIONS = 8;
const VALID_TYPES = new Set(['MC', 'TF', 'YN', 'MT']);

const textField = (description, maxLength) => ({
  type: 'string',
  minLength: 1,
  maxLength,
  description,
});

const mcQuestionSchema = {
  type: 'object',
  properties: {
    type: { const: 'MC' },
    text: textField('The complete question prompt.', 500),
    options: {
      type: 'array',
      minItems: 2,
      maxItems: MAX_OPTIONS,
      items: textField('A concise answer option.', 240),
      description: 'Plausible, mutually distinct answer choices.',
    },
    correct: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_OPTIONS,
      uniqueItems: true,
      items: { type: 'integer', minimum: 0, maximum: MAX_OPTIONS - 1 },
      description: 'Zero-based indexes of every correct option. Use one index unless the question explicitly asks for multiple answers.',
    },
  },
  required: ['type', 'text', 'options', 'correct'],
  additionalProperties: false,
};

function booleanQuestionSchema(type, labels) {
  return {
    type: 'object',
    properties: {
      type: { const: type },
      text: textField(`A statement or question answerable with ${labels}.`, 500),
      correct: { type: 'boolean', description: `The correct ${labels} value.` },
    },
    required: ['type', 'text', 'correct'],
    additionalProperties: false,
  };
}

const matchingQuestionSchema = {
  type: 'object',
  properties: {
    type: { const: 'MT' },
    text: textField('The matching instructions or prompt.', 500),
    left: {
      type: 'array',
      minItems: 2,
      maxItems: MAX_OPTIONS,
      items: textField('A left-column matching item.', 180),
    },
    right: {
      type: 'array',
      minItems: 2,
      maxItems: MAX_OPTIONS,
      items: textField('A right-column matching item.', 180),
    },
    pairs: {
      type: 'array',
      minItems: 2,
      maxItems: MAX_OPTIONS,
      items: {
        type: 'array',
        minItems: 2,
        maxItems: 2,
        prefixItems: [
          { type: 'integer', minimum: 0, maximum: MAX_OPTIONS - 1 },
          { type: 'integer', minimum: 0, maximum: MAX_OPTIONS - 1 },
        ],
        items: false,
        description: '[zero-based left index, zero-based right index]',
      },
      description: 'One pair for each left item. Every left and right index must be used exactly once.',
    },
  },
  required: ['type', 'text', 'left', 'right', 'pairs'],
  additionalProperties: false,
};

const questionInputSchema = {
  oneOf: [
    mcQuestionSchema,
    booleanQuestionSchema('TF', 'true or false'),
    booleanQuestionSchema('YN', 'yes or no'),
    matchingQuestionSchema,
  ],
};

const openQuizInputSchema = {
  type: 'object',
  properties: {
    title: textField('Short display title for the quiz.', 160),
    topic: textField('The subject being tested.', 240),
    difficulty: {
      type: 'string',
      enum: [...QUIZ_DIFFICULTIES],
      default: 'medium',
      description: DIFFICULTY_SCHEMA_DESCRIPTION,
    },
    questions: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_QUESTIONS,
      items: questionInputSchema,
      description: 'The complete, ready-to-run quiz. Write and fact-check every question before calling this tool.',
    },
  },
  required: ['title', 'topic', 'questions'],
  additionalProperties: false,
};

const canonicalQuestionOutputSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['MC', 'TF', 'YN', 'MT'] },
    text: { type: 'string' },
    options: { type: 'array', items: { type: 'string' } },
    correct: {
      oneOf: [
        { type: 'boolean' },
        { type: 'array', items: { type: 'integer' } },
      ],
    },
    left: { type: 'array', items: { type: 'string' } },
    right: { type: 'array', items: { type: 'string' } },
    pairs: {
      type: 'array',
      items: { type: 'array', items: { type: 'integer' } },
    },
  },
  required: ['type', 'text'],
  additionalProperties: false,
};

const quizOutputSchema = {
  type: 'object',
  properties: {
    quizId: { type: 'string' },
    title: { type: 'string' },
    topic: { type: 'string' },
    difficulty: { type: 'string', enum: [...QUIZ_DIFFICULTIES] },
    questions: { type: 'array', items: canonicalQuestionOutputSchema },
    questionCount: { type: 'integer' },
    aiGenerated: { type: 'boolean' },
  },
  required: ['quizId', 'title', 'topic', 'difficulty', 'questions', 'questionCount', 'aiGenerated'],
  additionalProperties: false,
};

function objectValue(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireOnlyKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new Error(`${label} contains unsupported field: ${unexpected[0]}`);
}

function strictString(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  const text = value.trim();
  if (text.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer`);
  return text;
}

function distinctStrings(value, label, minItems, maxItems, maxLength) {
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) {
    throw new Error(`${label} must contain ${minItems} to ${maxItems} items`);
  }
  const items = value.map((item, index) => strictString(item, `${label}[${index}]`, maxLength));
  const unique = new Set(items.map((item) => item.toLocaleLowerCase()));
  if (unique.size !== items.length) throw new Error(`${label} must not contain duplicates`);
  return items;
}

function normalizeIndexes(value, label, size) {
  if (!Array.isArray(value) || value.length < 1 || value.length > size) {
    throw new Error(`${label} must contain at least one index`);
  }
  const indexes = value.map((index) => {
    if (!Number.isInteger(index) || index < 0 || index >= size) {
      throw new Error(`${label} contains an out-of-range index`);
    }
    return index;
  });
  if (new Set(indexes).size !== indexes.length) throw new Error(`${label} must not contain duplicate indexes`);
  return indexes.sort((a, b) => a - b);
}

function normalizeQuestion(value, index) {
  const raw = objectValue(value, `questions[${index}]`);
  const type = String(raw.type || '').trim().toUpperCase();
  if (!VALID_TYPES.has(type)) throw new Error(`questions[${index}].type must be MC, TF, YN, or MT`);
  requireOnlyKeys(
    raw,
    type === 'MC'
      ? ['type', 'text', 'options', 'correct']
      : (type === 'MT' ? ['type', 'text', 'left', 'right', 'pairs'] : ['type', 'text', 'correct']),
    `questions[${index}]`,
  );
  const text = strictString(raw.text, `questions[${index}].text`, 500);

  if (type === 'MC') {
    const options = distinctStrings(raw.options, `questions[${index}].options`, 2, MAX_OPTIONS, 240);
    const correct = normalizeIndexes(raw.correct, `questions[${index}].correct`, options.length);
    return { type, text, options, correct };
  }

  if (type === 'TF' || type === 'YN') {
    if (typeof raw.correct !== 'boolean') throw new Error(`questions[${index}].correct must be a boolean`);
    return { type, text, correct: raw.correct };
  }

  const left = distinctStrings(raw.left, `questions[${index}].left`, 2, MAX_OPTIONS, 180);
  const right = distinctStrings(raw.right, `questions[${index}].right`, 2, MAX_OPTIONS, 180);
  if (left.length !== right.length) throw new Error(`questions[${index}] matching columns must have the same length`);
  if (!Array.isArray(raw.pairs) || raw.pairs.length !== left.length) {
    throw new Error(`questions[${index}].pairs must contain one pair per left item`);
  }
  const pairs = raw.pairs.map((pair, pairIndex) => {
    if (!Array.isArray(pair) || pair.length !== 2) throw new Error(`questions[${index}].pairs[${pairIndex}] must contain two indexes`);
    const [leftIndex, rightIndex] = pair;
    if (!Number.isInteger(leftIndex) || leftIndex < 0 || leftIndex >= left.length) {
      throw new Error(`questions[${index}].pairs[${pairIndex}] has an invalid left index`);
    }
    if (!Number.isInteger(rightIndex) || rightIndex < 0 || rightIndex >= right.length) {
      throw new Error(`questions[${index}].pairs[${pairIndex}] has an invalid right index`);
    }
    return [leftIndex, rightIndex];
  });
  if (new Set(pairs.map(([leftIndex]) => leftIndex)).size !== left.length) {
    throw new Error(`questions[${index}].pairs must use every left index exactly once`);
  }
  if (new Set(pairs.map(([, rightIndex]) => rightIndex)).size !== right.length) {
    throw new Error(`questions[${index}].pairs must use every right index exactly once`);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  return { type, text, left, right, pairs };
}

function normalizeOpenQuizArgs(value) {
  const raw = objectValue(value, 'quiz');
  requireOnlyKeys(raw, ['title', 'topic', 'difficulty', 'questions'], 'quiz');
  const title = strictString(raw.title, 'title', 160);
  const topic = strictString(raw.topic, 'topic', 240);
  const difficulty = String(raw.difficulty || 'medium').trim().toLowerCase();
  if (!QUIZ_DIFFICULTIES.includes(difficulty)) {
    throw new Error(`difficulty must be ${QUIZ_DIFFICULTIES.slice(0, -1).join(', ')}, or ${QUIZ_DIFFICULTIES.at(-1)}`);
  }
  if (!Array.isArray(raw.questions) || raw.questions.length < 1 || raw.questions.length > MAX_QUESTIONS) {
    throw new Error(`questions must contain 1 to ${MAX_QUESTIONS} items`);
  }
  const questions = raw.questions.map(normalizeQuestion);
  const stable = JSON.stringify({ title, topic, difficulty, questions });
  const quizId = crypto.createHash('sha256').update(stable).digest('hex').slice(0, 20);
  return {
    quizId,
    title,
    topic,
    difficulty,
    questions,
    questionCount: questions.length,
    aiGenerated: true,
  };
}

module.exports = {
  MAX_QUESTIONS,
  normalizeOpenQuizArgs,
  openQuizInputSchema,
  quizOutputSchema,
};
