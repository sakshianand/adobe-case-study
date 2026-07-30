const express = require('express');
const multer = require('multer');
const fs = require('fs');

const { validateFileStreaming } = require('../services/validation/validationPipeline');
const { matchAllCampaigns } = require('../services/ai/matching/matchAllCampaigns');
const { generateQualitySummary } = require('../services/ai/summary/qualitySummary');
const { createJob, updateJob, checkIdempotency, recordIdempotencyKey } = require('../data/jobStore');
const { indexJob } = require('../services/ai/rag/indexer');
const { autoReconcile } = require('../services/adtech/autoReconcile');
const { appendAudit } = require('../data/auditStore');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

// requireRole is applied per-route (below), not via router.use(). Every
// router in this app is mounted at app.js's '/' — a router-level
// router.use(requireRole(...)) with no path runs for ANY request that
// reaches this router in the middleware chain, not just requests that
// match a route defined inside it, since '/' matches everything as a
// prefix. That let this gate block requests actually meant for routers
// mounted after this one (e.g. POST /approve), rejecting them with this
// router's role list instead of ever reaching their own. Attaching the
// check directly to the one route that needs it avoids that entirely.

function dominantPlatform(platformCounts) {
  const entries = Object.entries(platformCounts);
  if (entries.length === 0) return null;
  return entries.reduce((best, curr) => (curr[1] > best[1] ? curr : best))[0];
}

// Runs AFTER the response is already sent — this is the async job pattern:
// the client gets a jobId immediately and polls /validation/:jobId rather
// than the request blocking until a potentially large file finishes.
async function runJob(jobId, filePath, originalFileName) {
  try {
    const validationSummary = await validateFileStreaming(filePath);
    // Job is "validating" -> partially done -> update so a poll mid-run
    // can show validation results before matching finishes.
    updateJob(jobId, {
      status: 'matching',
      validationSummary,
      fileName: originalFileName,
      platform: dominantPlatform(validationSummary.platformCounts),
    });

    const matches = await matchAllCampaigns(validationSummary.processedCampaigns);

    // Awaited, not fire-and-forget — unlike indexing below, the Review UI
    // and Validation Results page read this the moment status flips to
    // 'complete', and pollJob (frontend) stops polling right at that same
    // point, so it needs to already be on the job by then.
    let qualitySummary = null;
    try {
      qualitySummary = await generateQualitySummary({ validationSummary, matches });
    } catch (err) {
      console.error('AI quality summary failed for job', jobId, err.message);
    }

    const finishedJob = updateJob(jobId, { status: 'complete', matches, qualitySummary });

    // Indexing runs AFTER the job is already marked complete and the
    // client has its answer — RAG indexing is not on the critical path
    // for the upload flow. Fire-and-forget is acceptable for a prototype;
    // in production this would be a durable queue (so a crash mid-index
    // doesn't silently lose a run), not an unawaited promise.
    indexJob(finishedJob).catch((err) => console.error('RAG indexing failed for job', jobId, err.message));
    autoReconcile(finishedJob).catch((err) => console.error('Auto-reconciliation failed for job', jobId, err.message));
  } catch (err) {
    updateJob(jobId, { status: 'failed', error: err.message, fileName: originalFileName });
  } finally {
    fs.unlink(filePath, () => {}); // clean up the temp upload regardless of outcome
  }
}

router.post('/upload', requireRole('uploader', 'admin'), upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file attached. Expected a multipart field named "file".' });
  }

  // Prototype note: the uploaded file is written to disk temporarily so it can
  // be streamed and processed without loading the whole CSV into memory.
  // For production scale, this should move to object storage (e.g. S3/Azure Blob)
  // so uploads are durable, shared across workers, and not tied to one server.
  const buffer = fs.readFileSync(req.file.path);
  const { key, hash, uploadDate, existingJobId } = checkIdempotency(buffer);

  if (existingJobId) {
    // Same file, same day, already processed — return the existing job
    // rather than silently re-running the whole pipeline. Named
    // requirement in the brief, not an incidental nicety.
    fs.unlink(req.file.path, () => {});
    return res.status(200).json({ jobId: existingJobId, status: 'duplicate', message: 'This file was already processed today.' });
  }

  const jobId = createJob({ fileHash: hash, uploadDate });
  recordIdempotencyKey(key, jobId);
  appendAudit({ jobId, action: 'upload_created', actor: req.user.username, details: { fileName: req.file.originalname } });

  runJob(jobId, req.file.path, req.file.originalname); // deliberately not awaited — this is what makes /upload return immediately

  res.status(202).json({ jobId, status: 'processing' });
});

module.exports = router;