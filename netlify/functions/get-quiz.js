'use strict';

const { getPool } = require('./_db');

function resp(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return resp(405, { error: 'Method Not Allowed' }, { Allow: 'GET' });

  const id = (event.queryStringParameters && event.queryStringParameters.id)
    || (event.path && event.path.split('/').pop());
  if (!id || id.length > 32) return resp(400, { error: 'bad_id' });

  if (!process.env.DATABASE_URL) return resp(500, { error: 'Missing DATABASE_URL' });

  const pool = getPool();
  try {
    const { rows } = await pool.query(
      `SELECT id, title, questions, created_at FROM quizzes WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!rows.length) return resp(404, { error: 'not_found' });
    // Do not return answers here
    return resp(200, { ok: true, quiz: rows[0] });
  } catch (e) {
    console.error('select failed', e);
    return resp(500, { error: 'db_select_failed' });
  }
};

