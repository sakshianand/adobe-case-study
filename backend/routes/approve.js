const express = require('express');
const { getJob, updateJob } = require('../data/jobStore');
const { pushCampaignPerformance, buildPerformancePayload } = require('../services/adtech/adPlatformPush');
const { ingestJob } = require('../services/databricks/databricksIngestion');
const { appendAudit } = require('../data/auditStore');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('approver', 'admin')); // scoped to this router only — see upload.js's comment on why this can't live at the app.js mount call

// Runs AFTER the response is already sent — same async-job pattern as
// runJob in routes/upload.js. The reviewer gets an immediate "pushing"
// status back; the push result lands on the job a moment later and is
// picked up the next time the client polls (GET /validation/:jobId or
// GET /pipeline-status both read the same job record).
async function runPush(jobId) {
  const job = getJob(jobId);
  const campaigns = buildPerformancePayload(job.validationSummary, job.matches, job.decisions);

  try {
    const result = await pushCampaignPerformance({ qualityScore: job.validationSummary.qualityScore, campaigns });
    updateJob(jobId, {
      pushStatus: result.success ? 'success' : 'failed',
      pushedAt: new Date().toISOString(),
      pushResult: result,
    });
  } catch (err) {
    updateJob(jobId, {
      pushStatus: 'failed',
      pushedAt: new Date().toISOString(),
      pushResult: { success: false, error: err.message },
    });
  }
}

// Runs AFTER the response is already sent, same fire-and-poll pattern as
// runPush above. Databricks ingestion only ever runs against approved,
// complete jobs — the caller below gates on that before invoking this —
// which is the "push only approved, validated data" requirement.
async function runIngestion(jobId) {
  const job = getJob(jobId);
  updateJob(jobId, { ingestionStatus: 'ingesting' });

  const result = await ingestJob(job, { attemptsSoFar: 0 });

  updateJob(jobId, {
    ingestionStatus: result.status,
    ingestionAttempts: result.attempts,
    ingestionResult: result,
    ingestedAt: result.status === 'success' ? new Date().toISOString() : job.ingestedAt || null,
  });
}

// Commits the reviewer's approve/reject decisions on AI-suggested
// campaign-name matches for a job, then — per the brief — pushes
// validated campaign performance data back to the Ad platform AND into
// Databricks as a direct consequence of that approval, not as separately
// -triggered steps. Business-rule corrections and date/duplicate flags
// need no approval here: they're already auto-applied or informational,
// per how ReviewPage renders them (see qualitySummary.js's own note that
// campaign-name matches are the only thing that is ever a suggestion
// awaiting a human decision).
router.post('/approve', (req, res) => {
  const { jobId, decisions } = req.body || {};
  // `actor` comes from the verified session (req.user, set by requireAuth),
  // never from the request body — a client-supplied "reviewer" string
  // would let anyone attribute an approval to whoever they typed in,
  // which defeats the point of an audit trail. requireRole('approver',
  // 'admin') in app.js has already confirmed this session is allowed to
  // approve at all before this handler runs.
  const reviewer = req.user.username;

  if (!jobId) {
    return res.status(400).json({ error: 'jobId is required.' });
  }

  const job = getJob(jobId);
  if (!job) {
    return res.status(404).json({ error: 'No job found with that ID.' });
  }
  if (job.status !== 'complete') {
    return res.status(409).json({ error: `Job is not ready for approval yet (status: ${job.status}).` });
  }

  const approvedAt = new Date().toISOString();
  updateJob(jobId, {
    approved: true,
    approvedAt,
    approvedBy: reviewer,
    decisions: decisions || {},
    pushStatus: 'pushing',
    ingestionStatus: 'pending',
  });

  // The audit trail's "who approved, when, what changed" entry — written
  // synchronously as part of the request, unlike the two async side
  // effects below, since the decision itself (not its downstream
  // consequences) is the thing being audited.
  appendAudit({ jobId, action: 'approved', actor: reviewer, details: { decisions: decisions || {} } });

  runPush(jobId); // deliberately not awaited — mirrors /upload's fire-and-poll pattern
  runIngestion(jobId); // same pattern, tracked independently via job.ingestionStatus

  res.status(202).json({ jobId, approved: true, pushStatus: 'pushing', ingestionStatus: 'pending' });
});

module.exports = router;
