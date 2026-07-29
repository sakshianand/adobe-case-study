const crypto = require('crypto');

// In-memory Map, same tradeoff as jobStore.js: simple for a prototype, but
// schedule configs and run history don't survive a restart and aren't
// shared across instances. In production this belongs in the same durable
// store as jobs (Postgres/Redis-backed), not a separate system.
const schedules = new Map();

const VALID_SOURCES = ['Google', 'Meta', 'Amazon'];
const VALID_FREQUENCIES = ['hourly', 'daily', 'weekly', 'manual'];

function createSchedule({ source, frequency, time, dayOfWeek, timezone, notify }) {
  const id = crypto.randomUUID();
  const schedule = {
    id,
    source,
    frequency,
    time: time || '07:00', // HH:mm, ignored for hourly/manual
    dayOfWeek: dayOfWeek ?? 1, // 0=Sunday..6=Saturday, only used for weekly
    timezone: timezone || 'UTC',
    enabled: frequency !== 'manual', // manual schedules have nothing to enable — they only ever fire on demand
    notify: notify || { method: 'none', target: '' }, // { method: 'email'|'webhook'|'none', target: string }
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastRunAt: null,
    lastRunStatus: null, // 'success' | 'failed'
    lastRunJobId: null,
    runs: [], // recent run history, newest first — { runAt, status, jobId, error, triggeredBy }
  };
  schedules.set(id, schedule);
  return schedule;
}

function getSchedule(id) {
  return schedules.get(id) || null;
}

function listSchedules() {
  return Array.from(schedules.values()).sort((a, b) => a.source.localeCompare(b.source));
}

function updateSchedule(id, updates) {
  const schedule = schedules.get(id);
  if (!schedule) return null;
  Object.assign(schedule, updates, { updatedAt: new Date().toISOString() });
  return schedule;
}

function deleteSchedule(id) {
  return schedules.delete(id);
}

// Trims run history to the most recent 20 so it can't grow unbounded across
// a long-lived server process — same reasoning conversationStore.js's
// 6-turn cap uses, applied to run history instead of chat turns.
const MAX_RUN_HISTORY = 20;

function recordRun(id, { status, jobId, error, triggeredBy }) {
  const schedule = schedules.get(id);
  if (!schedule) return null;
  const runAt = new Date().toISOString();
  schedule.runs.unshift({ runAt, status, jobId: jobId || null, error: error || null, triggeredBy });
  schedule.runs = schedule.runs.slice(0, MAX_RUN_HISTORY);
  schedule.lastRunAt = runAt;
  schedule.lastRunStatus = status;
  schedule.lastRunJobId = jobId || null;
  return schedule;
}

module.exports = {
  VALID_SOURCES,
  VALID_FREQUENCIES,
  createSchedule,
  getSchedule,
  listSchedules,
  updateSchedule,
  deleteSchedule,
  recordRun,
};
