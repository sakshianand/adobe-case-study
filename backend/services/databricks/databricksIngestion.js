const store = require('../../data/databricksStore');
const { appendAudit } = require('../../data/auditStore');

// Real Databricks writes (e.g. via the Jobs API or a Delta table append)
// fail transiently often enough that "retry with backoff" is a real
// requirement, not a nice-to-have — network blips, cluster autoscale
// pauses, a table lock held by a concurrent writer. This stub can't
// reproduce those causes, so it simulates the shape instead, deterministically
// rather than randomly (so the retry path behaves the same way every run/test,
// the same documented tradeoff MIN_QUALITY_TO_PUSH makes in adPlatformPush.js):
// a write only succeeds once the CUMULATIVE attempt count (across both the
// automatic retries below and any later manual retry) reaches 4. The
// automatic loop only ever runs MAX_ATTEMPTS (3), so on its own it always
// exhausts and lands on 'failed' — exercising the "retry on failure"
// requirement on every single run — and a subsequent manual retry (one
// attempt, cumulative #4) is what actually recovers it.
const MAX_ATTEMPTS = 3;
const SUCCEEDS_AT_CUMULATIVE_ATTEMPT = 4;

function simulateNetworkDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function simulateWrite(cumulativeAttempt) {
  return cumulativeAttempt >= SUCCEEDS_AT_CUMULATIVE_ATTEMPT;
}

// Only approved rows are ever eligible to reach here (gated by the caller
// checking job.approved + job.status === 'complete'), but a row-level
// decision can still exclude an individual campaign match a reviewer
// rejected — mirrors buildPerformancePayload's own approved-name-or-raw
// fallback, except here every processed row is kept (Databricks wants the
// full cleaned dataset, not just the ones with a matched name) and a
// rejected suggestion just means the row keeps its raw uploaded name.
function buildCleanedRows(validationSummary, matches, decisions = {}) {
  const matchByRow = new Map(matches.map((m) => [m.row, m]));

  return validationSummary.processedCampaigns.map((campaign) => {
    const match = matchByRow.get(campaign.row);
    const decision = decisions[`match-${campaign.row}`];
    const action = typeof decision === 'string' ? decision : decision?.action;
    const correctedName = typeof decision === 'object' ? decision?.correctedName : undefined;
    const campaignName = match && match.action === 'suggest' && action === 'approved'
      ? (correctedName || match.matchedName)
      : campaign.campaignName;

    return {
      row: campaign.row,
      campaignName,
      spend: campaign.spend,
      impressions: campaign.impressions,
    };
  });
}

// Runs the raw-record write, the cleaned-rows write, and the retry loop
// around both — treated as a single unit of work per attempt since a real
// Databricks ingestion job would land both in the same run, not as two
// independently-retriable steps.
async function attemptIngestion(job, key, cleanedRows) {
  const rawRecord = {
    jobId: job.jobId,
    fileName: job.fileName || null,
    fileHash: job.fileHash,
    uploadDate: job.uploadDate,
    totalRows: job.validationSummary.totalRows,
    // The prototype's temp upload is deleted right after validation (see
    // upload.js's own note on that tradeoff), so there's no original byte
    // stream left to hand to a real raw-landing write by the time
    // ingestion runs. This stores the raw record's metadata as a stand-in
    // for the raw file itself — a production pipeline would persist the
    // object (S3/ADLS/Databricks Volumes) before the temp file is ever
    // cleaned up, then reference that path here instead.
    landedAt: new Date().toISOString(),
  };

  store.writeRaw(key, rawRecord);
  store.writeCleaned(key, cleanedRows);
  store.markIngested(key, job.jobId);

  return { rawRecord, cleanedRowCount: cleanedRows.length };
}

// Orchestrates one ingestion cycle for a job: idempotency check first, then
// up to `maxAttempts` retries with backoff, with an audit entry per attempt
// so "what happened and when" is fully reconstructable afterward.
// `attemptsSoFar` carries the cumulative attempt count across calls (the
// automatic run starts at 0; a manual retry passes in how many attempts
// already happened) so the deterministic success point is a property of
// the job's whole retry history, not any single call.
async function ingestJob(job, { attemptsSoFar = 0, maxAttempts = MAX_ATTEMPTS } = {}) {
  if (!job.fileHash || !job.uploadDate) {
    throw new Error('Job is missing fileHash/uploadDate — cannot compute an ingestion idempotency key.');
  }

  const key = store.ingestionKey(job.fileHash, job.uploadDate);

  if (store.alreadyIngested(key)) {
    appendAudit({ jobId: job.jobId, action: 'ingestion_skipped_duplicate', actor: 'system', details: { key } });
    return {
      status: 'success',
      skippedAsDuplicate: true,
      attempts: [],
      cleanedRowCount: store.getCleaned(key)?.length ?? null,
    };
  }

  const cleanedRows = buildCleanedRows(job.validationSummary, job.matches || [], job.decisions || {});
  const attempts = [];

  for (let i = 1; i <= maxAttempts; i++) {
    const cumulativeAttempt = attemptsSoFar + i;
    await simulateNetworkDelay(300 * i); // simple linear backoff between attempts within this call

    if (simulateWrite(cumulativeAttempt)) {
      const result = await attemptIngestion(job, key, cleanedRows);
      attempts.push({ attempt: cumulativeAttempt, at: new Date().toISOString(), outcome: 'success' });
      appendAudit({ jobId: job.jobId, action: 'ingestion_attempt_succeeded', actor: 'system', details: { attempt: cumulativeAttempt } });
      appendAudit({ jobId: job.jobId, action: 'ingestion_succeeded', actor: 'system', details: { key, cleanedRowCount: result.cleanedRowCount } });
      return { status: 'success', skippedAsDuplicate: false, attempts, cleanedRowCount: result.cleanedRowCount };
    }

    const error = 'Simulated transient write failure (network/cluster blip).';
    attempts.push({ attempt: cumulativeAttempt, at: new Date().toISOString(), outcome: 'failed', error });
    appendAudit({ jobId: job.jobId, action: 'ingestion_attempt_failed', actor: 'system', details: { attempt: cumulativeAttempt, error } });
  }

  appendAudit({ jobId: job.jobId, action: 'ingestion_failed', actor: 'system', details: { key, totalAttempts: attemptsSoFar + attempts.length } });
  return { status: 'failed', skippedAsDuplicate: false, attempts, error: attempts[attempts.length - 1].error };
}

module.exports = { ingestJob, buildCleanedRows, MAX_ATTEMPTS, SUCCEEDS_AT_CUMULATIVE_ATTEMPT };
