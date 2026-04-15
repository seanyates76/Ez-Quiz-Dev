'use strict';

/**
 * Netlify Function: explain-answers-lazy
 * POST /.netlify/functions/explain-answers-lazy
 * 
 * Uses Gemini via explainer_key env var.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

// CORS, rate limiting, and validation (preserved from original)
const parseAllowedOrigins = () => (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const makeCorsHeaders = (origin) => ({
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  ...(origin ? { 'Access-Control-Allow-Origin': origin } : {})
});

// Gemini setup
const genAI = new GoogleGenerativeAI(process.env.explainer_key);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

async function generateExplanation(question, answer) {
  const prompt = `Explain why this answer is correct in 1-2 sentences:\nQuestion: ${question}\nAnswer: ${answer}`;
  const result = await model.generateContent(prompt);
  return (await result.response).text();
}

exports.handler = async (event) => {
  // Preserved CORS/validation logic
  const origin = event.headers?.origin || event.headers?.Origin || '';
  const allowedOrigins = parseAllowedOrigins();
  const originAllowed = !origin || allowedOrigins.includes(origin);
  
  if (!originAllowed) return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden origin' }) };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: makeCorsHeaders(origin) };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: makeCorsHeaders(origin) };

  // Process request
  try {
    const { question, answer } = JSON.parse(event.body || '{}');
    if (!question || !answer) throw new Error('Missing question/answer');
    
    const explanation = await generateExplanation(question, answer);
    return {
      statusCode: 200,
      headers: { ...makeCorsHeaders(origin), 'Content-Type': 'application/json' },
      body: JSON.stringify({ explanation })
    };
  } catch (error) {
    return {
      statusCode: error.statusCode || 500,
      headers: makeCorsHeaders(origin),
      body: JSON.stringify({ error: error.message || 'Explanation failed' })
    };
  }
};