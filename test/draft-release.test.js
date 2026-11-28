const test = require('node:test');
const assert = require('node:assert');
const { decide } = require('../scripts/draft-release');

test('release: one draft per version, made before electron-builder uploads', () => {
  assert.equal(decide([], '0.3.7'), 'create');
  assert.equal(decide([{ id: 1, tag_name: 'v0.3.6', draft: false }], '0.3.7'), 'create');
  assert.equal(decide([{ id: 2, tag_name: 'v0.3.7', draft: true }], '0.3.7'), 'reuse');
  assert.throws(() => decide([{ id: 3, tag_name: 'v0.3.7', draft: false }], '0.3.7'), /already public/);
  assert.throws(() => decide([{ id: 4, tag_name: 'v0.3.7', draft: true }, { id: 5, tag_name: 'v0.3.7', draft: true }], '0.3.7'), /2 releases/);
});
