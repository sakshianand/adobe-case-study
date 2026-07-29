const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

// Every call goes through here so `credentials: 'include'` — required for
// the httpOnly session cookie to actually be sent/received — can't be
// forgotten on any individual endpoint. A 401 is thrown with a distinct
// marker so AuthContext can tell "not logged in" apart from any other
// error and redirect to /login instead of just showing an error string.
async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, { ...options, credentials: 'include' });
  if (res.status === 401) {
    const err = new Error('Not authenticated');
    err.unauthorized = true;
    throw err;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function jsonBody(body) {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export async function login(username, password) {
  return request('/auth/login', { method: 'POST', ...jsonBody({ username, password }) });
}

export async function logout() {
  return request('/auth/logout', { method: 'POST' });
}

export async function getCurrentUser() {
  return request('/auth/me');
}

export async function getDemoAccounts() {
  return request('/auth/demo-accounts');
}

export async function uploadFile(file) {
  const form = new FormData();
  form.append('file', file);
  return request('/upload', { method: 'POST', body: form });
}

export async function getJobStatus(jobId) {
  return request(`/validation/${jobId}`);
}

// Polls until the job reaches a terminal state (complete/failed), calling
// onUpdate after every poll so the UI can show partial progress — e.g.
// validation results appearing before matching finishes.
export function pollJob(jobId, onUpdate, intervalMs = 1000) {
  let cancelled = false;
  async function tick() {
    if (cancelled) return;
    const job = await getJobStatus(jobId);
    onUpdate(job);
    if (job.status === 'complete' || job.status === 'failed') return;
    setTimeout(tick, intervalMs);
  }
  tick();
  return () => { cancelled = true; };
}

export async function getReconciliation(jobId, threshold) {
  const query = threshold !== undefined ? `?threshold=${threshold}` : '';
  return request(`/reconciliation/${jobId}${query}`);
}

// Commits the reviewer's approve/reject decisions on AI-suggested campaign
// matches. Both the Ad Platform push and the Databricks ingestion (bonus
// features) run server-side as a direct consequence of this call, not as
// something the client triggers separately — see routes/approve.js.
// No `reviewer` argument: the server derives who approved from the
// authenticated session (req.user), not from anything the client sends —
// a client-supplied name would be trivially spoofable in an audit trail.
export async function approveJob(jobId, decisions) {
  return request('/approve', { method: 'POST', ...jsonBody({ jobId, decisions }) });
}

// Status + full audit history (who approved, when, what changed, every
// ingestion attempt) for a job's Databricks ingestion — see routes/databricks.js.
export async function getDatabricksStatus(jobId) {
  return request(`/databricks/${jobId}`);
}

// Manual recovery once automatic retries have been exhausted
// (ingestionStatus === 'failed') — makes exactly one more attempt.
export async function retryDatabricksIngestion(jobId) {
  return request(`/databricks/${jobId}/retry`, { method: 'POST', ...jsonBody({}) });
}

// job.status settles at 'complete' well before ingestion (a slower, later
// side effect of approval) settles — same reasoning as pollPushStatus below,
// just watching ingestionStatus instead of pushStatus.
export function pollIngestionStatus(jobId, onUpdate, intervalMs = 1000) {
  let cancelled = false;
  async function tick() {
    if (cancelled) return;
    const job = await getJobStatus(jobId);
    onUpdate(job);
    if (job.ingestionStatus === 'success' || job.ingestionStatus === 'failed') return;
    setTimeout(tick, intervalMs);
  }
  tick();
  return () => { cancelled = true; };
}

// job.status settles at 'complete' well before the push (a slower, later
// side effect of approval) settles — pollJob would stop watching too
// early, so the push needs its own terminal condition: pushStatus itself
// reaching 'success' or 'failed'.
export function pollPushStatus(jobId, onUpdate, intervalMs = 1000) {
  let cancelled = false;
  async function tick() {
    if (cancelled) return;
    const job = await getJobStatus(jobId);
    onUpdate(job);
    if (job.pushStatus === 'success' || job.pushStatus === 'failed') return;
    setTimeout(tick, intervalMs);
  }
  tick();
  return () => { cancelled = true; };
}

export async function getPipelineStatus() {
  return request('/pipeline-status');
}

export async function getSchedules() {
  return request('/schedules');
}

export async function createSchedule(schedule) {
  return request('/schedules', { method: 'POST', ...jsonBody(schedule) });
}

export async function updateSchedule(id, updates) {
  return request(`/schedules/${id}`, { method: 'PUT', ...jsonBody(updates) });
}

export async function deleteSchedule(id) {
  return request(`/schedules/${id}`, { method: 'DELETE' });
}

export async function triggerSchedule(id) {
  return request(`/schedules/${id}/trigger`, { method: 'POST' });
}

export async function getDashboard() {
  return request('/dashboard');
}

export async function getAuditLog() {
  return request('/audit');
}

export async function queryAssistant(sessionId, message) {
  return request('/assistant/query', { method: 'POST', ...jsonBody({ sessionId, message }) });
}
