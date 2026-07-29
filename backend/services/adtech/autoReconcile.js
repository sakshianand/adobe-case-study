const { reconcileSpend } = require('./reconciliation');
const { updateJob } = require('../../data/jobStore');

// Runs reconciliation automatically once a job completes and caches the
// result on the job itself, rather than only computing it on-demand when
// someone opens the Reconciliation page (the previous behavior). Shares
// the same fire-and-forget shape as RAG indexing in upload.js/
// schedulerEngine.js: reconciliation isn't on the critical path for "is
// this upload done," and a job should still reach 'complete' even if the
// stubbed Ad Tech client errors.
//
// This is what lets the Dashboard's reconciliation-pass-rate-by-platform
// metric be populated for every completed run instead of only the ones a
// reviewer happened to click into.
async function autoReconcile(job) {
  try {
    const report = await reconcileSpend(job, {});
    updateJob(job.jobId, { reconciliation: report });
  } catch (err) {
    updateJob(job.jobId, { reconciliation: { error: err.message } });
  }
}

module.exports = { autoReconcile };
