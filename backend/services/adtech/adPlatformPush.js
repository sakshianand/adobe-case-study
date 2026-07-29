const crypto = require('crypto');

// Stubbed push to Google Ads — the same platform reconciliation reads
// from (googleAdsClient.js), so the story is coherent: pull actuals from
// the platform for reconciliation, push validated performance data back
// to the same platform post-approval. No real network call, no sandbox
// credentials — this simulates the shape of a batch upload response.
//
// Deterministic, not random: a batch is rejected if the run's quality
// score is below MIN_QUALITY_TO_PUSH. This reuses the Step 3 quality
// score rather than inventing a new failure trigger, and mirrors a real
// constraint — no ad platform should receive campaign performance data
// that failed most of its own validation.
const MIN_QUALITY_TO_PUSH = 70;

// Real batch-upload APIs (Google Ads offline conversion/adjustment
// uploads, Meta's Conversions API, Amazon's Advertising API) are async,
// paginated, and return a per-row accepted/rejected breakdown, often
// after a polling delay. This stub compresses that down to a single
// whole-batch accept/reject decision after a fixed simulated delay —
// documenting the gap rather than modeling retries or partial batch
// failures that aren't needed to demonstrate the pattern.
function simulateNetworkDelay(ms = 400) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Resolves each processed row to the name it should be pushed under: an
// approved AI suggestion's matchedName, or the raw uploaded name for
// anything rejected or never decided. Same canonical-name-with-fallback
// pattern reconciliation.js uses, but keyed off the reviewer's actual
// per-row decisions instead of confidence alone — a suggestion the
// reviewer explicitly rejected must not silently win here just because
// it once scored above the matcher's threshold.
function buildPerformancePayload(validationSummary, matches, decisions = {}) {
  const matchByRow = new Map(matches.map((m) => [m.row, m]));
  const totals = new Map(); // name -> { spend, impressions }

  for (const campaign of validationSummary.processedCampaigns) {
    const match = matchByRow.get(campaign.row);
    const decision = decisions[`match-${campaign.row}`];
    // Decisions come from the review UI as either a bare 'approved'/'rejected'
    // string or, when the reviewer inline-edited the suggested name before
    // approving, an { action, correctedName } object — correctedName wins
    // over the matcher's own suggestion when present.
    const action = typeof decision === 'string' ? decision : decision?.action;
    const correctedName = typeof decision === 'object' ? decision?.correctedName : undefined;
    const name = match && match.action === 'suggest' && action === 'approved'
      ? (correctedName || match.matchedName)
      : campaign.campaignName;

    const existing = totals.get(name) || { spend: 0, impressions: 0 };
    existing.spend += Number(campaign.spend) || 0;
    existing.impressions += Number(campaign.impressions) || 0;
    totals.set(name, existing);
  }

  return Array.from(totals, ([campaignName, totals]) => ({ campaignName, ...totals }));
}

async function pushCampaignPerformance({ qualityScore, campaigns }) {
  await simulateNetworkDelay();

  if (qualityScore < MIN_QUALITY_TO_PUSH) {
    return {
      success: false,
      platform: 'Google Ads',
      error: `Batch rejected: quality score ${qualityScore}% is below the platform's minimum of ${MIN_QUALITY_TO_PUSH}%.`,
      pushedCount: 0,
    };
  }

  return {
    success: true,
    platform: 'Google Ads',
    platformBatchId: `gads_batch_${crypto.randomUUID().slice(0, 8)}`,
    pushedCount: campaigns.length,
  };
}

module.exports = { pushCampaignPerformance, buildPerformancePayload, MIN_QUALITY_TO_PUSH };
