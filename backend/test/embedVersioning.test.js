const test = require('node:test');
const assert = require('node:assert/strict');

const { getEmbeddingVersionInfo } = require('../services/ai/embeddings/embedClient');
const { getEmbeddingCollectionName } = require('../services/ai/rag/indexer');

test('embedding version info exposes explicit model and pipeline versions', () => {
  const info = getEmbeddingVersionInfo();

  assert.equal(info.modelName, 'Xenova/all-MiniLM-L6-v2');
  assert.equal(info.modelVersion, 'v1');
  assert.equal(info.normalizationVersion, 'v1');
  assert.equal(info.embeddingSchemaVersion, 'v1');
});

test('embedding collection name is explicit and versioned', () => {
  assert.equal(getEmbeddingCollectionName(), 'ingestion_runs_v1');
});
