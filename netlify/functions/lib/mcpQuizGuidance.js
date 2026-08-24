'use strict';

const QUIZ_DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard', 'expert', 'mixed']);

const DIFFICULTY_SCHEMA_DESCRIPTION = [
  'The reasoning target for the complete quiz.',
  'easy checks direct facts, definitions, purposes, commands, or basic behavior without tricks;',
  'medium uses compact application that requires one inference, comparison, or cause-and-effect link;',
  'hard uses realistic applied judgment, troubleshooting, tradeoffs, or multi-step reasoning;',
  'expert uses advanced diagnosis, edge cases, competing interpretations, and subtle but useful distinctions;',
  'mixed deliberately progresses from foundations through applied and advanced reasoning.',
].join(' ');

const CHATGPT_QUIZ_INSTRUCTIONS = [
  'When the user asks for an EZ Quiz, write and fact-check the complete quiz yourself, then call open_quiz exactly once with structured questions.',
  'Use the conversation and user-supplied sources as hidden instructor knowledge. Every question and answer choice must stand alone; never refer to notes, files, source material, or provided text in the learner-facing quiz.',
  'Honor an explicit question count, topic, format, and difficulty request. If no difficulty is requested, use medium.',
  'Difficulty comes from the thinking required, not dense wording, obscure trivia, vague abstractions, or sneaky absolute words. Keep language clear and use technical terms only when the subject requires them.',
  'Easy tests one direct fact, definition, purpose, command, function, or basic behavior with short stems and no trick wording.',
  'Medium tests applied understanding with compact realistic scenarios requiring one inference, comparison, or cause-and-effect link; distractors are plausible but fair.',
  'Hard tests applied judgment, important distinctions, troubleshooting, design tradeoffs, command or evidence interpretation, or multi-step reasoning in the subject\'s real context.',
  'Expert tests advanced multi-step diagnosis, edge cases, competing interpretations, hidden dependencies, or subtle relationships while keeping one clearly supportable answer. Prefer useful mastery over niche trivia.',
  'Mixed difficulty should form a deliberate progression from direct foundations to application and then demanding synthesis, rather than a random blend.',
  'For relative requests, use the most recent quiz level when known: harder moves easy to medium, medium to hard, and hard to expert; easier moves in the opposite direction. Much harder, extreme, brutal, or expert means expert. If an expert quiz is made harder, deepen the diagnosis or distinctions without resorting to obscurity.',
  'Prefer authentic subject-matter questions such as troubleshooting, behavior, configuration, evidence interpretation, chronology, comparison, and tradeoff decisions when relevant.',
  'Make multiple-choice options complete, distinct, and grammatically parallel. Use multiple correct indexes only when the stem explicitly says to select multiple answers. True/false and yes/no items should test one claim at a time.',
  'Do not ask EZ Quiz to generate questions, do not send raw source material to the tool, and do not create loading or placeholder quiz calls.',
  'The EZ Quiz component owns question navigation, scoring, results review, attempt counting, and retakes.',
].join(' ');

module.exports = {
  CHATGPT_QUIZ_INSTRUCTIONS,
  DIFFICULTY_SCHEMA_DESCRIPTION,
  QUIZ_DIFFICULTIES,
};
