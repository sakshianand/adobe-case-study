const express = require('express');
const { getJob, updateJob } = require('../data/jobStore');
const { ingestJob } = require('../services/databricks/databricksIngestion');
const { appendAudit, getAuditForJob } = require('../data/auditStore');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Status + full audit history for a job's Databricks ingestion — what
// /approve kicked off, and everything that's happened to it since
// (attempts, retries, the original "who approved, when, what changed"
// entry included, so this one endpoint tells the whole story).
router.get('/databricks/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'No job found with that ID.' });
  }

  res.status(200).json({
    jobId: job.jobId,
    ingestionStatus: job.ingestionStatus || 'not_started',
    ingestionAttempts: job.ingestionAttempts || [],
    ingestedAt: job.ingestedAt || null,
    approvedBy: job.approvedBy || null,
    approvedAt: job.approvedAt || null,
    audit: getAuditForJob(job.jobId),
  });
});

// Manual recovery once the automatic retries triggered by /approve have
// been exhausted (job.ingestionStatus === 'failed') — makes exactly one
// more attempt, continuing the cumulative attempt count from
// job.ingestionAttempts rather than starting over, so the deterministic
// success point (services/databricks/databricksIngestion.js's
// SUCCEEDS_AT_CUMULATIVE_ATTEMPT) is a property of the job's whole retry
// history, not reset by however many times a reviewer clicks retry.
router.post('/databricks/:jobId/retry', requireRole('approver', 'admin'), async (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'No job found with that ID.' });
  }
  if (job.ingestionStatus !== 'failed') {
    return res.status(409).json({ error: `Ingestion is not in a failed state (status: ${job.ingestionStatus || 'not_started'}).` });
  }

  // Same principle as /approve: the actor is the verified session, never
  // a client-supplied field.
  const reviewer = req.user.username;
  appendAudit({ jobId: job.jobId, action: 'ingestion_retry_requested', actor: reviewer });
  updateJob(job.jobId, { ingestionStatus: 'ingesting' });

  const attemptsSoFar = (job.ingestionAttempts || []).length;
  const result = await ingestJob(job, { attemptsSoFar, maxAttempts: 1 });

  const updated = updateJob(job.jobId, {
    ingestionStatus: result.status,
    ingestionAttempts: [...(job.ingestionAttempts || []), ...result.attempts],
    ingestionResult: result,
    ingestedAt: result.status === 'success' ? new Date().toISOString() : job.ingestedAt || null,
  });

  res.status(200).json({ jobId: job.jobId, ingestionStatus: updated.ingestionStatus });
});

module.exports = router;
