/** @jest-environment node */
'use strict';
const { previewPolicy } = require('../standalone/prepare-preview.cjs');
const preview = { CONTEXT: 'deploy-preview', REVIEW_ID: '84', BRANCH: 'preview/adaptive-learning-profile' };
test('only the designated Netlify review build enables shared access', () => {
  expect(previewPolicy(preview).enabled).toBe(true);
  for (const override of [{ CONTEXT: 'production' }, { CONTEXT: 'branch-deploy' }, { REVIEW_ID: '85' }, { BRANCH: 'main' }]) {
    expect(previewPolicy({ ...preview, ...override }).enabled).toBe(false);
  }
  expect(previewPolicy({}).enabled).toBe(false);
});
test('the bundled policy contains no runtime key or other environment contents', () => {
  const policy = previewPolicy({ ...preview, ezq_bmok_shared: 'fake-secret', unrelated: 'private' });
  expect(policy).toEqual({ enabled: true, hostname: 'deploy-preview-84--ez-quiz.netlify.app' });
});
