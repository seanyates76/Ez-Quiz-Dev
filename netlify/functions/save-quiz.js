'use strict';

const crypto = require('crypto');
const { getPool } = require('./_db');

function resp(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return resp(405, { error: 'Method Not Allowed' }, { Allow: 'POST' });
  }

  if (!process.env.DATABASE_URL) return resp(500, { error: 'Missing DATABASE_URL' });

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return resp(400, { error: 'Invalid JSON' });
  }

  // Expect: { title: string, questions: [...], answers: [...] }
  const { title = '', questions, answers } = payload || {};

  if (!Array.isArray(questions) || questions.length === 0) return resp(400, { error: 'questions required' });
  if (!Array.isArray(answers) || answers.length === 0) return resp(400, { error: 'answers required' });

  const rawSize = Buffer.byteLength(event.body || '', 'utf8');
  if (rawSize > 200_000) return resp(413, { error: 'Payload too large' }); // ~200KB

  const id = crypto.randomBytes(8).toString('hex');

  const pool = getPool();
  try {
    await pool.query(
      `INSERT INTO quizzes (id, title, questions, answers) VALUES ($1,$2,$3::jsonb,$4::jsonb)`,
      [id, String(title).slice(0, 200), JSON.stringify(questions), JSON.stringify(answers)]
    );
  } catch (e) {
    console.error('insert failed', e);
    return resp(500, { error: 'db_insert_failed' });
  }

  return resp(200, { ok: true, id, path: `/q/${id}` });
};

