const test = require('node:test');
const assert = require('node:assert');

const { ingestJob, buildCleanedRows, SUCCEEDS_AT_CUMULATIVE_ATTEMPT } = require('../services/databricks/databricksIngestion');

function makeJob(overrides = {}) {
  return {
    jobId: `job-${Math.random().toString(36).slice(2)}`,
    fileHash: 'abc123',
    uploadDate: '2026-07-29',
    validationSummary: {
      processedCampaigns: [
        { row: 1, campaignName: 'Summer Sale', spend: 1000, impressions: 40000 },
        { row: 2, campaignName: 'Holiday Promo', spend: 500, impressions: 10000 },
      ],
    },
    matches: [
      { row: 1, uploadedName: 'Summer Sale', matchedName: 'Summer Sale 2025', confidence: 90, action: 'suggest' },
      { row: 2, uploadedName: 'Holiday Promo', matchedName: 'Holiday Launch', confidence: 76, action: 'suggest' },
    ],
    decisions: {},
    ...overrides,
  };
}

test('buildCleanedRows uses the corrected name only when the reviewer approved it', () => {
  const job = makeJob({ decisions: { 'match-1': 'approved', 'match-2': 'rejected' } });
  const rows = buildCleanedRows(job.validationSummary, job.matches, job.decisions);
  assert.equal(rows.find((r) => r.row === 1).campaignName, 'Summer Sale 2025');
  assert.equal(rows.find((r) => r.row === 2).campaignName, 'Holiday Promo');
});

test('buildCleanedRows honors an inline-edited correctedName over the matcher suggestion', () => {
  const job = makeJob({ decisions: { 'match-1': { action: 'approved', correctedName: 'Summer Sale (Edited)' } } });
  const rows = buildCleanedRows(job.validationSummary, job.matches, job.decisions);
  assert.equal(rows.find((r) => r.row === 1).campaignName, 'Summer Sale (Edited)');
});

test('the automatic retry loop (3 attempts) always exhausts and lands on failed', async () => {
  const job = makeJob();
  const result = await ingestJob(job, { attemptsSoFar: 0, maxAttempts: 3 });
  assert.equal(result.status, 'failed');
  assert.equal(result.attempts.length, 3);
  assert.ok(result.attempts.every((a) => a.outcome === 'failed'));
});

test('a manual retry continuing from the exhausted cumulative count succeeds', async () => {
  const job = makeJob();
  const first = await ingestJob(job, { attemptsSoFar: 0, maxAttempts: 3 });
  assert.equal(first.status, 'failed');

  const retry = await ingestJob(job, { attemptsSoFar: first.attempts.length, maxAttempts: 1 });
  assert.equal(retry.status, 'success');
  assert.equal(retry.attempts[0].attempt, SUCCEEDS_AT_CUMULATIVE_ATTEMPT);
});

test('ingesting the same fileHash+date twice is a no-op the second time (idempotency)', async () => {
  const job = makeJob({ jobId: 'idem-job', fileHash: 'idem-hash', uploadDate: '2026-07-29' });
  const first = await ingestJob(job, { attemptsSoFar: 0, maxAttempts: 3 });
  const second = await ingestJob(job, { attemptsSoFar: first.attempts.length, maxAttempts: 1 }); // recovers to success
  assert.equal(second.status, 'success');

  const third = await ingestJob(job, { attemptsSoFar: 0, maxAttempts: 3 });
  assert.equal(third.status, 'success');
  assert.equal(third.skippedAsDuplicate, true);
  assert.equal(third.attempts.length, 0);
});
