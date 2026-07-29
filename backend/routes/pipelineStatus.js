const express = require('express');
const { listJobs } = require('../data/jobStore');

const router = express.Router();

// "Current and historical pipeline state" per the brief — a flat list of
// every run this server instance has seen (in-memory only, like the rest
// of jobStore.js — see its own tradeoff note), newest first, trimmed to
// the fields the dashboard actually renders rather than the full job
// object (which includes the entire validationSummary payload).
router.get('/pipeline-status', (req, res) => {
  const jobs = listJobs().map((job) => ({
    jobId: job.jobId,
    fileName: job.fileName || null,
    createdAt: job.createdAt,
    status: job.status,
    qualityScore: job.validationSummary?.qualityScore ?? null,
    approved: job.approved || false,
    approvedAt: job.approvedAt || null,
    pushStatus: job.pushStatus || 'not_started',
    pushedAt: job.pushedAt || null,
    pushResult: job.pushResult || null,
    ingestionStatus: job.ingestionStatus || 'not_started',
    ingestedAt: job.ingestedAt || null,
  }));

  res.status(200).json({ jobs });
});

module.exports = router;
