const test = require('node:test');
const assert = require('node:assert');

const {
  normalizeForMatching,
  computeLexicalSimilarity,
  computeMatchConfidence,
} = require('../services/ai/matching/campaignMatcher');
const { fuzzySimilarity } = require('../services/ai/matching/fuzzySimilarity');

test('normalizes and boosts obvious campaign-name variants', () => {
  const normalizedA = normalizeForMatching('SummerSale25');
  const normalizedB = normalizeForMatching('Summer Sale 2025');

  assert.equal(normalizedA, 'summer sale');
  assert.equal(normalizedB, 'summer sale');
  assert.equal(computeLexicalSimilarity('SummerSale25', 'Summer Sale 2025'), 1);
  assert.ok(fuzzySimilarity('SummerSale25', 'Summer Sale 2025') > 0.7);
  assert.equal(computeMatchConfidence(0.2, 'SummerSale25', 'Summer Sale 2025'), 1);
});

test('keeps unrelated names in the low-confidence range', () => {
  const score = computeMatchConfidence(0.1, 'XYZ Campaign', 'Summer Sale 2025');
  assert.ok(score <= 0.2);
  assert.equal(computeLexicalSimilarity('XYZ Campaign', 'Summer Sale 2025'), 0);
});
