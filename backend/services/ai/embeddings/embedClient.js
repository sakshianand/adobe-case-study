const { pipeline } = require('@xenova/transformers');

const EMBEDDING_MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_MODEL_VERSION = 'v1';
const NORMALIZATION_VERSION = 'v1';
const EMBEDDING_SCHEMA_VERSION = 'v1';

let embedderPromise = null;

// Current embedding model: Xenova/all-MiniLM-L6-v2.
// We now keep explicit version metadata so the embedding pipeline is reproducible
// and safe to evolve. If the model or normalization logic changes later, we can
// create a new versioned collection and re-embed historical content without mixing
// vectors from different pipelines.
function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = pipeline('feature-extraction', EMBEDDING_MODEL_NAME);
  }
  return embedderPromise;
}

function getEmbeddingVersionInfo() {
  return {
    modelName: EMBEDDING_MODEL_NAME,
    modelVersion: EMBEDDING_MODEL_VERSION,
    normalizationVersion: NORMALIZATION_VERSION,
    embeddingSchemaVersion: EMBEDDING_SCHEMA_VERSION,
  };
}

async function embed(text) {
  const embedder = await getEmbedder();
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

module.exports = { embed, getEmbeddingVersionInfo };