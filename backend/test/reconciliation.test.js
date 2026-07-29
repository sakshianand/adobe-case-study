const test = require('node:test');
const assert = require('node:assert');

const { reconcileSpend, computeVariance } = require('../services/adtech/reconciliation');
const { CANNED_PLATFORM_SPEND } = require('../services/adtech/googleAdsClient');

function makeJob({ processedCampaigns, matches = [] }) {
  return {
    status: 'complete',
    validationSummary: { processedCampaigns },
    matches,
  };
}

test('computeVariance is measured against the uploaded figure', () => {
  // Matches the brief's own worked example: $900 off on an $8,200 upload
  // is quoted as "11%" ($900/$8,200), not 9.9% ($900/$9,100).
  assert.equal(Math.round((900 / 8200) * 100), 11);
  assert.equal(computeVariance(12400, 12350), (50 / 12400));
  assert.equal(computeVariance(0, 0), 0);
  assert.equal(computeVariance(100, 0), 1);
  assert.equal(computeVariance(0, 100), 1);
});

test('flags an in-tolerance variance as a match', async () => {
  const job = makeJob({
    processedCampaigns: [{ row: 1, campaignName: 'Summer Sale', spend: 12400 }],
    matches: [{ row: 1, uploadedName: 'Summer Sale', matchedName: 'Summer Sale 2025', confidence: 94, action: 'suggest' }],
  });

  const report = await reconcileSpend(job, { threshold: 0.05 });
  const row = report.rows.find((r) => r.campaign === 'Summer Sale 2025');

  assert.equal(row.status, 'match');
  assert.equal(row.reportedSpend, CANNED_PLATFORM_SPEND['Summer Sale 2025']);
});

test('flags a >5% variance for review', async () => {
  const job = makeJob({
    processedCampaigns: [{ row: 1, campaignName: 'Holiday Promo', spend: 8200 }],
    matches: [{ row: 1, uploadedName: 'Holiday Promo', matchedName: 'Holiday Launch', confidence: 91, action: 'suggest' }],
  });

  const report = await reconcileSpend(job, { threshold: 0.05 });
  const row = report.rows.find((r) => r.campaign === 'Holiday Launch');

  assert.equal(row.status, 'review');
  assert.ok(row.variance > 5);
});

test('sums spend across duplicate rows for the same canonical campaign', async () => {
  const job = makeJob({
    processedCampaigns: [
      { row: 1, campaignName: 'Back to School', spend: 3000 },
      { row: 2, campaignName: 'Back to School', spend: 2000 },
    ],
    matches: [
      { row: 1, uploadedName: 'Back to School', matchedName: 'Back To School', confidence: 97, action: 'suggest' },
      { row: 2, uploadedName: 'Back to School', matchedName: 'Back To School', confidence: 97, action: 'suggest' },
    ],
  });

  const report = await reconcileSpend(job, { threshold: 0.05 });
  const row = report.rows.find((r) => r.campaign === 'Back To School');

  assert.equal(row.uploadedSpend, 5000);
  assert.equal(row.status, 'match');
});

test('a campaign with no confident match falls back to the raw uploaded name and shows unmatched', async () => {
  const job = makeJob({
    processedCampaigns: [{ row: 1, campaignName: 'Mystery Campaign', spend: 500 }],
    matches: [{ row: 1, uploadedName: 'Mystery Campaign', matchedName: null, confidence: 12, action: 'flag_for_review' }],
  });

  const report = await reconcileSpend(job, { threshold: 0.05 });
  const row = report.rows.find((r) => r.campaign === 'Mystery Campaign');

  assert.equal(row.status, 'unmatched_upload');
  assert.equal(row.reportedSpend, null);
});

test('a platform campaign never present in the upload surfaces as unmatched_platform', async () => {
  const job = makeJob({
    processedCampaigns: [{ row: 1, campaignName: 'Summer Sale', spend: 12400 }],
    matches: [{ row: 1, uploadedName: 'Summer Sale', matchedName: 'Summer Sale 2025', confidence: 94, action: 'suggest' }],
  });

  const report = await reconcileSpend(job, { threshold: 0.05 });
  const winterClearance = report.rows.find((r) => r.campaign === 'Winter Clearance');

  assert.ok(winterClearance);
  assert.equal(winterClearance.status, 'unmatched_platform');
  assert.equal(winterClearance.uploadedSpend, null);
});

test('reconcileSpend rejects a job with no validation summary yet', async () => {
  await assert.rejects(() => reconcileSpend({ status: 'complete' }), /no processed campaign data/);
});
