// Append-only audit log — the "who approved, when, what changed" record
// Step 6 asks for. In-memory like jobStore.js and the same tradeoff
// applies: fine for a prototype, would move to a durable append-only table
// (or Databricks' own audit log) in production so history survives restarts.
const auditLog = []; // { jobId, action, actor, at, details }

function appendAudit({ jobId, action, actor, details }) {
  const entry = { jobId, action, actor: actor || 'unknown', at: new Date().toISOString(), details: details || null };
  auditLog.push(entry);
  return entry;
}

// Oldest first — a history reads top-to-bottom like a timeline.
function getAuditForJob(jobId) {
  return auditLog.filter((e) => e.jobId === jobId);
}

// Newest first, capped — powers the admin-only Audit Log screen. Not
// filtered by jobId, so this also surfaces non-job events (login,
// schedule changes) that getAuditForJob would never show.
function listAudit(limit = 200) {
  return auditLog.slice(-limit).reverse();
}

module.exports = { appendAudit, getAuditForJob, listAudit };
