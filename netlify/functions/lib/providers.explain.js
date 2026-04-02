'use strict';

/**
 * Explanation providers for lazy on-demand explanations.
 * 
 * This module provides explanation generation for quiz questions without
 * altering the existing generation pipeline. It's designed to be stateless
 * and minimal-cost, only generating explanations when explicitly requested.
 */

// Build explanation prompt for batched questions
function buildExplanationPrompt(questions) {
  const prompt = [
    'Task: Provide concise explanations for the following quiz questions.',
    'Format your response with numbered sections (Q1:, Q2:, etc.) followed by the explanation.',
    'Keep each explanation under 240 characters and focus on the key reasoning.',
    '',
    'Questions:'
  ];

  questions.forEach((q, index) => {
    const qNum = index + 1;
    prompt.push(`Q${qNum}: ${q.text}`);
    
    if (q.type === 'MC') {
      prompt.push(`Options: ${q.options.map((opt, i) => `${String.fromCharCode(65 + i)}) ${opt}`).join('; ')}`);
      const correctLetters = q.correct.map(i => String.fromCharCode(65 + i)).join(', ');
      prompt.push(`Correct answer(s): ${correctLetters}`);
    } else if (q.type === 'TF') {
      prompt.push(`Correct answer: ${q.correct ? 'True' : 'False'}`);
    } else if (q.type === 'YN') {
      prompt.push(`Correct answer: ${q.correct ? 'Yes' : 'No'}`);
    } else if (q.type === 'MT') {
      prompt.push(`Left items: ${q.left.map((item, i) => `${i + 1}) ${item}`).join('; ')}`);
      prompt.push(`Right items: ${q.right.map((item, i) => `${String.fromCharCode(65 + i)}) ${item}`).join('; ')}`);
      const pairStrings = q.pairs.map(([li, ri]) => `${li + 1}-${String.fromCharCode(65 + ri)}`);
      prompt.push(`Correct matches: ${pairStrings.join(', ')}`);
    }
    prompt.push('');
  });

  prompt.push('Provide explanations in this format:');
  prompt.push('Q1: Brief explanation of why this answer is correct...');
  prompt.push('Q2: Brief explanation of why this answer is correct...');
  
  return prompt.join('\n');
}

// Parse explanation output back to indexed format
function parseExplanationOutput(text, originalIndices) {
  const explanations = {};
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  
  for (const line of lines) {
    const match = line.match(/^Q(\d+):\s*(.+)$/);
    if (match) {
      const qNum = parseInt(match[1], 10);
      const explanation = match[2].trim();
      
      // Map back to original index
      if (qNum > 0 && qNum <= originalIndices.length) {
        const originalIndex = originalIndices[qNum - 1];
        explanations[originalIndex] = { explanation };
      }
    }
  }
  
  return explanations;
}

// Echo provider for testing/development
function echoExplain(questions, originalIndices) {
  const explanations = {};
  
  questions.forEach((q, index) => {
    const originalIndex = originalIndices[index];
    let explanation = `Rationale stub for practice. `;
    
    if (q.type === 'MC') {
      const correctLetters = q.correct.map(i => String.fromCharCode(65 + i)).join(', ');
      explanation += `Correct: ${correctLetters}. `;
    } else if (q.type === 'TF') {
      explanation += `${q.correct ? 'True' : 'False'} statement. `;
    } else if (q.type === 'YN') {
      explanation += `Answer is ${q.correct ? 'Yes' : 'No'}. `;
    } else if (q.type === 'MT') {
      explanation += `Match pairs correctly. `;
    }
    
    explanation += `This is a practice explanation for ${q.type} question type.`;
    
    explanations[originalIndex] = { explanation };
  });
  
  return explanations;
}

// Future: Real AI provider integration
async function geminiExplain({ apiKey, model = 'gemini-2.5-flash-lite', questions, originalIndices }) {
  // TODO: Implement real Gemini API integration
  // const { GoogleGenerativeAI } = await import('@google/generative-ai');
  // const genAI = new GoogleGenerativeAI(apiKey);
  // const m = genAI.getGenerativeModel({ model });
  // const prompt = buildExplanationPrompt(questions);
  // const result = await m.generateContent({ ... });
  // return parseExplanationOutput(result.response.text(), originalIndices);
  
  throw new Error('Gemini explanations not implemented yet - use echo provider');
}

// Future: OpenAI provider integration  
async function openaiExplain({ apiKey, model = 'gpt-4o-mini', questions, originalIndices }) {
  // TODO: Implement OpenAI API integration
  // const prompt = buildExplanationPrompt(questions);
  // const resp = await fetch('https://api.openai.com/v1/chat/completions', { ... });
  // const data = await resp.json();
  // return parseExplanationOutput(data.choices[0].message.content, originalIndices);
  
  throw new Error('OpenAI explanations not implemented yet - use echo provider');
}

// Main explanation function
async function explainQuestions({ provider, model, questions, originalIndices, env }) {
  const p = (provider || (env.AI_PROVIDER || 'echo')).toLowerCase();
  
  try {
    if (p === 'gemini') {
      return await geminiExplain({ 
        apiKey: env.GEMINI_API_KEY, 
        model: model || env.GEMINI_MODEL || 'gemini-2.5-flash-lite', 
        questions, 
        originalIndices 
      });
    }
    
    if (p === 'openai') {
      return await openaiExplain({ 
        apiKey: env.OPENAI_API_KEY, 
        model: model || env.OPENAI_MODEL || 'gpt-4o-mini', 
        questions, 
        originalIndices 
      });
    }
    
    if (p === 'echo') {
      return echoExplain(questions, originalIndices);
    }
    
    throw new Error(`Unknown explanation provider: ${provider}`);
  } catch (err) {
    // Propagate with lightweight shape
    const e = new Error(String(err && err.message || err));
    e.status = err && err.status;
    e.details = err && err.details;
    throw e;
  }
}

module.exports = { 
  explainQuestions,
  buildExplanationPrompt,  // Export for testing
  parseExplanationOutput   // Export for testing
};
