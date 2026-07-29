const crypto = require('crypto');

// In-memory Map for the prototype. In production this should move to a
// durable store such as Postgres or Redis-backed job state so data survives
// restarts and remains visible across multiple backend instances.
// This is a tradeoff: in-memory storage is simple and fast, but it is not
// resilient or horizontally scalable for production workloads.
const jobs = new Map();
const seenFileHashes = new Map(); // fileHash -> jobId, for idempotency

// fileHash/uploadDate are stamped on the job at creation (not just used
// transiently for the upload-level dedup check below) so downstream steps
// — Databricks ingestion's own idempotency key — can reference the same
// file+date identity without re-hashing anything.
function createJob({ fileHash, uploadDate } = {}) {
  const jobId = crypto.randomUUID();
  jobs.set(jobId, { jobId, status: 'processing', createdAt: new Date().toISOString(), fileHash, uploadDate });
  return jobId;
}

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

// Powers the RAG assistant's STRUCTURED query path — "how many X last
// week", "files below 80%". Returns exact matches from real job history,
// not a fuzzy retrieval. The LLM only phrases this result into prose
// later; it never sees raw job data to count or filter itself.
function queryJobs({ platform, qualityScoreBelow, qualityScoreAbove, sinceDate, status } = {}) {
  return Array.from(jobs.values()).filter((job) => {
    if (status && job.status !== status) return false;
    if (platform && job.platform !== platform) return false;
    if (qualityScoreBelow !== undefined && !(job.validationSummary?.qualityScore < qualityScoreBelow)) return false;
    if (qualityScoreAbove !== undefined && !(job.validationSummary?.qualityScore > qualityScoreAbove)) return false;
    if (sinceDate && new Date(job.createdAt) < new Date(sinceDate)) return false;
    return true;
  });
}

const TERMINAL_STATUSES = ['complete', 'failed'];

function updateJob(jobId, updates) {
  const job = jobs.get(jobId);
  if (!job) return null;
  Object.assign(job, updates);
  // Stamped here rather than at each call site so every path that can end a
  // job (upload.js's runJob, the scheduler's runIngestionPipeline) gets
  // processing latency for free instead of needing to remember to set it.
  // `!job.completedAt` guards against a later updateJob call (e.g. the
  // dashboard's reconciliation follow-up) overwriting the real finish time.
  if (TERMINAL_STATUSES.includes(updates.status) && !job.completedAt) {
    job.completedAt = new Date().toISOString();
  }
  return job;
}

// Newest first — powers GET /pipeline-status, which shows current +
// historical pipeline state across every run, not just one job's.
function listJobs() {
  return Array.from(jobs.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// Idempotency key is file hash + date, per the brief. Date is folded into
// the hash input itself rather than tracked separately, so re-uploading
// the identical file on a different day is treated as a new run.
function fileHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function checkIdempotency(buffer) {
  const today = new Date().toISOString().slice(0, 10);
  const hash = fileHash(buffer);
  const key = hash + '|' + today;
  const existingJobId = seenFileHashes.get(key);
  return { key, hash, uploadDate: today, existingJobId };
}

function recordIdempotencyKey(key, jobId) {
  seenFileHashes.set(key, jobId);
}

module.exports = { createJob, getJob, updateJob, listJobs, queryJobs, checkIdempotency, recordIdempotencyKey, fileHash };