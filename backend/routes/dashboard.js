const express = require('express');
const { listJobs } = require('../data/jobStore');
const { listQueries } = require('../data/queryLogStore');

const router = express.Router();

function round1(n) {
  return Math.round(n * 10) / 10;
}

function computeTotals(jobs) {
  return {
    processed: jobs.length,
    successful: jobs.filter((j) => j.status === 'complete').length,
    failed: jobs.filter((j) => j.status === 'failed').length,
    inProgress: jobs.filter((j) => j.status === 'processing' || j.status === 'matching').length,
  };
}

// Ascending by createdAt (oldest first) so the trend reads left-to-right
// like a timeline, capped to the most recent 30 runs so the sparkline
// doesn't get unreadably dense on a long-lived server.
function computeQualityTrend(jobs) {
  return jobs
    .filter((j) => j.validationSummary?.qualityScore !== undefined)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-30)
    .map((j) => ({
      jobId: j.jobId,
      fileName: j.fileName || null,
      createdAt: j.createdAt,
      qualityScore: j.validationSummary.qualityScore,
    }));
}

// Grouped by the upload's own `platform` field (Google/Meta/Amazon/Adobe),
// not by report.platform — the reconciliation stub (googleAdsClient.js)
// always compares against one canned Google Ads dataset regardless of
// which platform a file came from, so report.platform would collapse
// every group into "Google Ads." Grouping by the upload's platform still
// gives a meaningful per-source pass rate; it's just honest that the
// "platform reported" side of every comparison currently comes from the
// one stubbed Ad Tech client.
function computeReconciliationByPlatform(jobs) {
  const groups = {};

  for (const job of jobs) {
    const report = job.reconciliation;
    if (!report || report.error || !report.summary) continue;

    const platform = job.platform || 'Unknown';
    const g = groups[platform] || { matched: 0, review: 0, unmatchedUpload: 0, unmatchedPlatform: 0, jobsReconciled: 0 };
    g.matched += report.summary.matched;
    g.review += report.summary.review;
    g.unmatchedUpload += report.summary.unmatchedUpload;
    g.unmatchedPlatform += report.summary.unmatchedPlatform;
    g.jobsReconciled += 1;
    groups[platform] = g;
  }

  return Object.entries(groups).map(([platform, g]) => {
    const decided = g.matched + g.review;
    return {
      platform,
      ...g,
      passRate: decided > 0 ? round1((g.matched / decided) * 100) : null,
    };
  });
}

function computeRagQueryHistory() {
  const queries = listQueries();
  return {
    totalQueries: queries.length,
    structuredCount: queries.filter((q) => q.route === 'structured').length,
    semanticCount: queries.filter((q) => q.route === 'semantic').length,
    recent: queries.slice(0, 10),
  };
}

// "Correction" = an AI-suggested campaign-name match (matches[].action ===
// 'suggest') — the matcher never auto-applies, so every suggestion is a
// pending human decision until the reviewer approves/rejects it via
// /approve, which lands in job.decisions keyed 'match-<row>'.
function computeAiCorrections(jobs) {
  let suggested = 0;
  let approved = 0;
  let rejected = 0;

  for (const job of jobs) {
    if (!job.matches) continue;
    const decisions = job.decisions || {};
    for (const match of job.matches) {
      if (match.action !== 'suggest') continue;
      suggested += 1;
      const decision = decisions[`match-${match.row}`];
      const action = typeof decision === 'string' ? decision : decision?.action;
      if (action === 'approved') approved += 1;
      else if (action === 'rejected') rejected += 1;
    }
  }

  const decided = approved + rejected;
  return {
    suggested,
    approved,
    rejected,
    pending: suggested - decided,
    acceptanceRate: decided > 0 ? round1((approved / decided) * 100) : null,
  };
}

// "Health" = share of terminal runs that ended successfully. Latency =
// wall-clock time between job creation and jobStore stamping completedAt
// (see jobStore.js's updateJob) — covers validate+match+summarize, not the
// fire-and-forget RAG indexing/reconciliation that runs after.
function computePipelineHealth(jobs) {
  const terminal = jobs.filter((j) => j.status === 'complete' || j.status === 'failed');
  const withLatency = terminal.filter((j) => j.completedAt);
  const latencies = withLatency.map((j) => new Date(j.completedAt) - new Date(j.createdAt));

  return {
    successRate: terminal.length > 0 ? round1((terminal.filter((j) => j.status === 'complete').length / terminal.length) * 100) : null,
    avgLatencyMs: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
    recentLatencies: withLatency
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
      .slice(0, 10)
      .map((j) => ({ jobId: j.jobId, fileName: j.fileName || null, latencyMs: new Date(j.completedAt) - new Date(j.createdAt) })),
  };
}

router.get('/dashboard', (req, res) => {
  const jobs = listJobs();

  res.status(200).json({
    totals: computeTotals(jobs),
    qualityTrend: computeQualityTrend(jobs),
    reconciliationByPlatform: computeReconciliationByPlatform(jobs),
    ragQueryHistory: computeRagQueryHistory(),
    aiCorrections: computeAiCorrections(jobs),
    pipelineHealth: computePipelineHealth(jobs),
  });
});

module.exports = router;
