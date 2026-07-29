const { matchCampaign } = require('./campaignMatcher');

// Runs AFTER validation completes, over the { row, campaignName } list the
// pipeline collected — deliberately a separate pass, not inlined into the
// CSV stream loop. Keeps two concerns apart: the streaming validator stays
// synchronous and simple, matching stays async and can be reasoned about,
// tested, and rate-limited on its own.
//
// Sequential, not Promise.all — a local embedding model has no per-call
// network cost to overlap, and running many at once just contends for the
// same CPU-bound inference. If this were a real API call (Groq/OpenAI
// embeddings), this is exactly where you'd add a small concurrency limit
// (e.g. p-limit) instead of firing every row's request at once.
async function matchAllCampaigns(processedCampaigns) {
  const results = [];
  for (const { row, campaignName } of processedCampaigns) {
    const match = await matchCampaign(campaignName);
    results.push({ row, ...match });
  }
  return results;
}

module.exports = { matchAllCampaigns };