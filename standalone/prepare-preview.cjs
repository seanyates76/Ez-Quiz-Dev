#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Only non-secret deployment policy is bundled. The key is read at runtime.
function previewPolicy(env) {
  return {
    enabled: env.CONTEXT === 'deploy-preview' && env.REVIEW_ID === '84' && env.BRANCH === 'preview/adaptive-learning-profile',
    hostname: 'deploy-preview-84--ez-quiz.netlify.app',
  };
}
if (require.main === module) {
  fs.writeFileSync(path.join(__dirname, '../netlify/functions/lib/shared-preview.json'), JSON.stringify(previewPolicy(process.env)) + '\n');
}
module.exports = { previewPolicy };
