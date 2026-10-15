'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBody } = require('../studio/lib/modelcontract');
const model = require('../studio/seed/models.json').models.find(m => m.id === 'seedance-2.5');
test('Seedance 2.5 matches the supplied MuAPI request contract without paid calls', () => {
  assert.ok(model);
  assert.equal(model.endpoint, 'seedance-2.5-image-to-video');
  const body = buildBody(model, { prompt: 'Animate a park', imageUrl: 'https://example.test/park.jpg', aspectRatio: '9:16', duration: 5, negativePrompt: 'none' });
  assert.deepEqual(body, {
    resolution: '720p', seed: 42, high_bitrate: false, draft: false, draft_request_id: '',
    prompt: 'Animate a park', image_url: 'https://example.test/park.jpg', duration: 5,
  });
  assert.equal(model.verification, 'unverified');
  assert.equal(model.costEstimateUsd, undefined);
});
