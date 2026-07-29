const { embed } = require('../embeddings/embedClient');
const { cosineSimilarity } = require('./cosineSimilarity');
const { getMasterEmbeddings } = require('./masterCampaignList');
const { normalizeForEmbedding } = require('./normalizeForEmbedding');

// The brief gives only two reference points (94%/91%/97% -> suggest,
// 12% -> flag) with a wide unstated gap between them. 70% is a judgment
// call, not a derived number — documented as such rather than presented
// as if it were given. In production this would be tuned against a
// labeled sample of real mismatches, not guessed once and left alone.
const SUGGEST_THRESHOLD = 0.60;

// Never auto-applies a match — always returns a suggestion for a human
// to approve or reject, per the brief's stated pattern for every one
// of its confidence examples.
async function matchCampaign(uploadedName) {
  const uploadedVector = await embed(normalizeForEmbedding(uploadedName));
  const masterEmbeddings = await getMasterEmbeddings();

  let best = null;
  for (const candidate of masterEmbeddings) {
    const score = cosineSimilarity(uploadedVector, candidate.vector);
    if (!best || score > best.score) {
      best = { name: candidate.name, score };
    }
  }

  const confidence = Math.round(best.score * 100);

  if (confidence >= SUGGEST_THRESHOLD * 100) {
    return {
      uploadedName,
      matchedName: best.name,
      confidence,
      action: 'suggest',
    };
  }

  return {
    uploadedName,
    matchedName: null,
    confidence,
    action: 'flag_for_review',
  };
}

module.exports = { matchCampaign, SUGGEST_THRESHOLD };