const express = require('express');
const { getJob } = require('../data/jobStore');
const { reconcileSpend, DEFAULT_VARIANCE_THRESHOLD } = require('../services/adtech/reconciliation');

const router = express.Router();

router.get('/reconciliation/:jobId', async (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'No job found with that ID.' });
  }

  // Matching (Step 3) needs to have already resolved canonical campaign
  // names before spend can be aggregated against them meaningfully — the
  // same "complete" gate the Review UI waits on for `job.matches`.
  if (job.status !== 'complete') {
    return res.status(409).json({ error: `Job is not ready for reconciliation yet (status: ${job.status}).` });
  }

  const thresholdParam = req.query.threshold !== undefined ? Number(req.query.threshold) : DEFAULT_VARIANCE_THRESHOLD;
  if (Number.isNaN(thresholdParam) || thresholdParam < 0) {
    return res.status(400).json({ error: 'threshold must be a non-negative number, e.g. 0.05 for 5%.' });
  }

  try {
    const report = await reconcileSpend(job, { threshold: thresholdParam });
    res.status(200).json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
