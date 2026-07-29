const cron = require('node-cron');
const fs = require('fs');

const { toCronExpression } = require('./cronExpression');
const { fetchSourceFile } = require('./sourceFetcher');
const { notifyFailure } = require('./notifier');
const { recordRun, updateSchedule } = require('../../data/scheduleStore');
const { validateFileStreaming } = require('../validation/validationPipeline');
const { matchAllCampaigns } = require('../ai/matching/matchAllCampaigns');
const { generateQualitySummary } = require('../ai/summary/qualitySummary');
const { createJob, updateJob } = require('../../data/jobStore');
const { indexJob } = require('../ai/rag/indexer');
const { autoReconcile } = require('../adtech/autoReconcile');
const { appendAudit } = require('../../data/auditStore');

// scheduleId -> the live node-cron ScheduledTask, so a schedule can be
// stopped/replaced when it's disabled, edited, or deleted. Not persisted —
// same in-memory-only tradeoff as everything else here; a restart re-derives
// this map from scheduleStore's (also in-memory) configs on boot.
const liveTasks = new Map();

// Deliberately duplicates upload.js's runJob rather than importing it: that
// function is wired to a multer request (req.file), while this path starts
// from a source fetch instead of a browser upload. The pipeline steps
// themselves (validate -> match -> summarize -> index) are identical, and
// stay identical here so a scheduled run and a manual upload are graded by
// the exact same rules.
async function runIngestionPipeline({ filePath, originalFileName, source, scheduleId, triggeredBy, actor }) {
  const jobId = createJob({});
  updateJob(jobId, { fileName: originalFileName, platform: source, triggeredBy, scheduleId });
  appendAudit({ jobId, action: 'scheduled_upload_created', actor: actor || 'system (cron)', details: { fileName: originalFileName, scheduleId, triggeredBy } });

  try {
    const validationSummary = await validateFileStreaming(filePath);
    updateJob(jobId, { status: 'matching', validationSummary });

    const matches = await matchAllCampaigns(validationSummary.processedCampaigns);

    let qualitySummary = null;
    try {
      qualitySummary = await generateQualitySummary({ validationSummary, matches });
    } catch (err) {
      console.error('AI quality summary failed for scheduled job', jobId, err.message);
    }

    const finishedJob = updateJob(jobId, { status: 'complete', matches, qualitySummary });
    indexJob(finishedJob).catch((err) => console.error('RAG indexing failed for scheduled job', jobId, err.message));
    autoReconcile(finishedJob).catch((err) => console.error('Auto-reconciliation failed for scheduled job', jobId, err.message));

    return { jobId, status: 'success' };
  } catch (err) {
    updateJob(jobId, { status: 'failed', error: err.message });
    return { jobId, status: 'failed', error: err.message };
  } finally {
    fs.unlink(filePath, () => {});
  }
}

async function runScheduledIngestion(schedule, triggeredBy = 'schedule', actor) {
  try {
    const { filePath, originalFileName } = await fetchSourceFile(schedule.source);
    const result = await runIngestionPipeline({
      filePath,
      originalFileName,
      source: schedule.source,
      scheduleId: schedule.id,
      triggeredBy,
      actor,
    });

    recordRun(schedule.id, { status: result.status, jobId: result.jobId, error: result.error, triggeredBy });

    if (result.status === 'failed') {
      await notifyFailure(schedule, { error: result.error, jobId: result.jobId });
    }

    return result;
  } catch (err) {
    // Source fetch itself failed, before there's even a job to point to.
    recordRun(schedule.id, { status: 'failed', error: err.message, triggeredBy });
    await notifyFailure(schedule, { error: err.message });
    return { status: 'failed', error: err.message };
  }
}

function stopTask(scheduleId) {
  const task = liveTasks.get(scheduleId);
  if (task) {
    task.stop();
    liveTasks.delete(scheduleId);
  }
}

// (Re)registers a schedule's cron task. Safe to call repeatedly — always
// stops any existing task for this id first, so editing frequency/time or
// toggling enabled just calls this again rather than needing separate
// add/remove code paths.
function syncTask(schedule) {
  stopTask(schedule.id);

  if (!schedule.enabled || schedule.frequency === 'manual') return;

  const expression = toCronExpression(schedule);
  if (!expression) return;

  const task = cron.schedule(expression, () => runScheduledIngestion(schedule), { timezone: schedule.timezone });
  liveTasks.set(schedule.id, task);
}

// Called once at server boot to bring live cron tasks in sync with
// whatever schedules already exist in the store (none, for a fresh
// in-memory store — this matters more once schedules survive a restart).
function startAll(schedules) {
  schedules.forEach(syncTask);
}

module.exports = { runScheduledIngestion, syncTask, stopTask, startAll };
