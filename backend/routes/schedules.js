const express = require('express');
const {
  VALID_SOURCES,
  VALID_FREQUENCIES,
  createSchedule,
  getSchedule,
  listSchedules,
  updateSchedule,
  deleteSchedule,
} = require('../data/scheduleStore');
const { syncTask, stopTask, runScheduledIngestion } = require('../services/scheduler/schedulerEngine');
const { appendAudit } = require('../data/auditStore');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('admin')); // scoped to this router only — see upload.js's comment on why this can't live at the app.js mount call

function validateBody({ source, frequency, time, dayOfWeek }) {
  if (!VALID_SOURCES.includes(source)) {
    return `source must be one of: ${VALID_SOURCES.join(', ')}`;
  }
  if (!VALID_FREQUENCIES.includes(frequency)) {
    return `frequency must be one of: ${VALID_FREQUENCIES.join(', ')}`;
  }
  if (time && !/^\d{2}:\d{2}$/.test(time)) {
    return 'time must be in HH:mm format';
  }
  if (dayOfWeek !== undefined && (dayOfWeek < 0 || dayOfWeek > 6)) {
    return 'dayOfWeek must be 0 (Sunday) through 6 (Saturday)';
  }
  return null;
}

router.get('/schedules', (req, res) => {
  res.status(200).json({ schedules: listSchedules() });
});

router.post('/schedules', (req, res) => {
  const { source, frequency, time, dayOfWeek, timezone, notify } = req.body || {};
  const validationError = validateBody({ source, frequency, time, dayOfWeek });
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const schedule = createSchedule({ source, frequency, time, dayOfWeek, timezone, notify });
  syncTask(schedule);
  appendAudit({ action: 'schedule_created', actor: req.user.username, details: { scheduleId: schedule.id, source, frequency } });
  res.status(201).json({ schedule });
});

router.put('/schedules/:id', (req, res) => {
  const existing = getSchedule(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'No schedule found with that ID.' });
  }

  const { source, frequency, time, dayOfWeek, timezone, notify, enabled } = req.body || {};
  const merged = {
    source: source ?? existing.source,
    frequency: frequency ?? existing.frequency,
    time: time ?? existing.time,
    dayOfWeek: dayOfWeek ?? existing.dayOfWeek,
  };
  const validationError = validateBody(merged);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const schedule = updateSchedule(req.params.id, {
    ...merged,
    timezone: timezone ?? existing.timezone,
    notify: notify ?? existing.notify,
    enabled: enabled ?? existing.enabled,
  });
  syncTask(schedule);
  appendAudit({ action: 'schedule_updated', actor: req.user.username, details: { scheduleId: schedule.id, changes: req.body } });
  res.status(200).json({ schedule });
});

router.delete('/schedules/:id', (req, res) => {
  const existing = getSchedule(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'No schedule found with that ID.' });
  }
  stopTask(req.params.id);
  deleteSchedule(req.params.id);
  appendAudit({ action: 'schedule_deleted', actor: req.user.username, details: { scheduleId: req.params.id, source: existing.source } });
  res.status(204).send();
});

// Manual trigger — "Manual" frequency's only way to fire, but also usable
// for any schedule to run once right now without waiting for its next
// cron tick (e.g. testing a newly-created schedule).
router.post('/schedules/:id/trigger', async (req, res) => {
  const schedule = getSchedule(req.params.id);
  if (!schedule) {
    return res.status(404).json({ error: 'No schedule found with that ID.' });
  }

  const result = await runScheduledIngestion(schedule, 'manual', req.user.username);
  appendAudit({ jobId: result.jobId, action: 'schedule_triggered_manually', actor: req.user.username, details: { scheduleId: schedule.id } });
  res.status(200).json({ result, schedule: getSchedule(req.params.id) });
});

module.exports = router;
