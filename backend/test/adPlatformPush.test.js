const test = require('node:test');
const assert = require('node:assert');

const { pushCampaignPerformance, buildPerformancePayload, MIN_QUALITY_TO_PUSH } = require('../services/adtech/adPlatformPush');

test('buildPerformancePayload uses the matched name only when the reviewer approved it', () => {
  const validationSummary = {
    processedCampaigns: [
      { row: 1, campaignName: 'Summer Sale', spend: 1000, impressions: 40000 },
      { row: 2, campaignName: 'Holiday Promo', spend: 500, impressions: 10000 },
    ],
  };
  const matches = [
    { row: 1, uploadedName: 'Summer Sale', matchedName: 'Summer Sale 2025', action: 'suggest' },
    { row: 2, uploadedName: 'Holiday Promo', matchedName: 'Holiday Launch', action: 'suggest' },
  ];
  const decisions = { 'match-1': 'approved', 'match-2': 'rejected' };

  const payload = buildPerformancePayload(validationSummary, matches, decisions);
  const names = payload.map((p) => p.campaignName).sort();

  assert.deepEqual(names, ['Holiday Promo', 'Summer Sale 2025']);
});

test('buildPerformancePayload falls back to the raw name when a suggestion was never decided', () => {
  const validationSummary = {
    processedCampaigns: [{ row: 1, campaignName: 'Summer Sale', spend: 1000, impressions: 40000 }],
  };
  const matches = [{ row: 1, uploadedName: 'Summer Sale', matchedName: 'Summer Sale 2025', action: 'suggest' }];

  const payload = buildPerformancePayload(validationSummary, matches, {});
  assert.equal(payload[0].campaignName, 'Summer Sale');
});

test('buildPerformancePayload sums spend and impressions across rows for the same name', () => {
  const validationSummary = {
    processedCampaigns: [
      { row: 1, campaignName: 'Back To School', spend: 1000, impressions: 10000 },
      { row: 2, campaignName: 'Back To School', spend: 2000, impressions: 20000 },
    ],
  };

  const payload = buildPerformancePayload(validationSummary, [], {});
  assert.equal(payload.length, 1);
  assert.equal(payload[0].spend, 3000);
  assert.equal(payload[0].impressions, 30000);
});

test('pushCampaignPerformance succeeds when quality score clears the platform minimum', async () => {
  const result = await pushCampaignPerformance({ qualityScore: MIN_QUALITY_TO_PUSH, campaigns: [{ campaignName: 'X', spend: 1, impressions: 1 }] });
  assert.equal(result.success, true);
  assert.ok(result.platformBatchId);
  assert.equal(result.pushedCount, 1);
});

test('pushCampaignPerformance rejects a batch below the platform minimum quality', async () => {
  const result = await pushCampaignPerformance({ qualityScore: MIN_QUALITY_TO_PUSH - 1, campaigns: [] });
  assert.equal(result.success, false);
  assert.match(result.error, /below the platform's minimum/);
});
