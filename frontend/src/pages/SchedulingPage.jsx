import { useEffect, useState } from 'react';
import { getSchedules, createSchedule, updateSchedule, deleteSchedule, triggerSchedule } from '../api/client';
import StatusBadge from '../components/StatusBadge';

const SOURCES = ['Google', 'Meta', 'Amazon'];
const FREQUENCIES = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'manual', label: 'Manual only' },
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleString() : 'never';
}

function describeCadence(schedule) {
  if (schedule.frequency === 'manual') return 'Manual trigger only';
  if (schedule.frequency === 'hourly') return `Hourly, at :${String(schedule.time.split(':')[1]).padStart(2, '0')}`;
  if (schedule.frequency === 'daily') return `Daily at ${schedule.time} ${schedule.timezone}`;
  if (schedule.frequency === 'weekly') return `Weekly on ${DAYS[schedule.dayOfWeek]} at ${schedule.time} ${schedule.timezone}`;
  return schedule.frequency;
}

const inputStyle = {
  fontSize: 13,
  padding: '6px 8px',
  border: '0.5px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg)',
  color: 'inherit',
};

function NewScheduleForm({ onCreated }) {
  const [source, setSource] = useState(SOURCES[0]);
  const [frequency, setFrequency] = useState('daily');
  const [time, setTime] = useState('07:00');
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [notifyMethod, setNotifyMethod] = useState('none');
  const [notifyTarget, setNotifyTarget] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { schedule } = await createSchedule({
        source,
        frequency,
        time,
        dayOfWeek: Number(dayOfWeek),
        notify: { method: notifyMethod, target: notifyTarget },
      });
      onCreated(schedule);
      setNotifyTarget('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: 'var(--surface)',
        border: '0.5px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: 16,
        marginBottom: 24,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        alignItems: 'flex-end',
      }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--ink-secondary)' }}>
        Source
        <select value={source} onChange={(e) => setSource(e.target.value)} style={inputStyle}>
          {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--ink-secondary)' }}>
        Frequency
        <select value={frequency} onChange={(e) => setFrequency(e.target.value)} style={inputStyle}>
          {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </label>

      {(frequency === 'daily' || frequency === 'weekly') && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--ink-secondary)' }}>
          Time
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={inputStyle} />
        </label>
      )}

      {frequency === 'weekly' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--ink-secondary)' }}>
          Day
          <select value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)} style={inputStyle}>
            {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </label>
      )}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--ink-secondary)' }}>
        Notify on failure
        <select value={notifyMethod} onChange={(e) => setNotifyMethod(e.target.value)} style={inputStyle}>
          <option value="none">None</option>
          <option value="email">Email</option>
          <option value="webhook">Webhook</option>
        </select>
      </label>

      {notifyMethod !== 'none' && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--ink-secondary)' }}>
          {notifyMethod === 'email' ? 'Email address' : 'Webhook URL'}
          <input
            type="text"
            value={notifyTarget}
            onChange={(e) => setNotifyTarget(e.target.value)}
            placeholder={notifyMethod === 'email' ? 'oncall@example.com' : 'https://…'}
            style={{ ...inputStyle, width: 200 }}
          />
        </label>
      )}

      <button
        type="submit"
        disabled={submitting}
        style={{
          fontSize: 13,
          fontWeight: 500,
          padding: '7px 14px',
          borderRadius: 'var(--radius-sm)',
          border: 'none',
          background: 'var(--brand)',
          color: '#fff',
          cursor: submitting ? 'default' : 'pointer',
          opacity: submitting ? 0.6 : 1,
        }}
      >
        {submitting ? 'Adding…' : 'Add schedule'}
      </button>

      {error && <p style={{ color: 'var(--rejected-fg)', fontSize: 12, width: '100%', margin: 0 }}>{error}</p>}
    </form>
  );
}

function ScheduleCard({ schedule, onChange }) {
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function toggleEnabled() {
    setBusy(true);
    try {
      const { schedule: updated } = await updateSchedule(schedule.id, { enabled: !schedule.enabled });
      onChange(updated);
    } finally {
      setBusy(false);
    }
  }

  async function handleTrigger() {
    setBusy(true);
    try {
      const { schedule: updated } = await triggerSchedule(schedule.id);
      onChange(updated);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await deleteSchedule(schedule.id);
      onChange(null, schedule.id);
    } finally {
      setBusy(false);
    }
  }

  const statusVariant = schedule.lastRunStatus === 'success' ? 'verified' : schedule.lastRunStatus === 'failed' ? 'rejected' : 'review';
  const statusLabel = schedule.lastRunStatus === 'success' ? 'Last run succeeded' : schedule.lastRunStatus === 'failed' ? 'Last run failed' : 'No runs yet';

  return (
    <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{schedule.source}</span>
            <StatusBadge variant={statusVariant} label={statusLabel} />
            {!schedule.enabled && schedule.frequency !== 'manual' && <StatusBadge variant="rejected" label="Disabled" />}
          </div>
          <p style={{ fontSize: 13, color: 'var(--ink-secondary)', margin: 0 }}>{describeCadence(schedule)}</p>
          <p style={{ fontSize: 12, color: 'var(--ink-secondary)', margin: '2px 0 0' }}>
            Last run: {formatDate(schedule.lastRunAt)}
            {schedule.notify?.method !== 'none' && ` · Notify on failure via ${schedule.notify.method} (${schedule.notify.target || 'no target set'})`}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button disabled={busy} onClick={handleTrigger} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '0.5px solid var(--border)', background: 'var(--bg)', cursor: busy ? 'default' : 'pointer' }}>
            Run now
          </button>
          {schedule.frequency !== 'manual' && (
            <button disabled={busy} onClick={toggleEnabled} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '0.5px solid var(--border)', background: 'var(--bg)', cursor: busy ? 'default' : 'pointer' }}>
              {schedule.enabled ? 'Disable' : 'Enable'}
            </button>
          )}
          <button disabled={busy} onClick={() => setExpanded((v) => !v)} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '0.5px solid var(--border)', background: 'var(--bg)', cursor: 'pointer' }}>
            {expanded ? 'Hide history' : 'History'}
          </button>
          <button disabled={busy} onClick={handleDelete} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '0.5px solid var(--border)', background: 'var(--bg)', color: 'var(--rejected-fg)', cursor: busy ? 'default' : 'pointer' }}>
            Delete
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, borderTop: '0.5px solid var(--border)', paddingTop: 12 }}>
          {schedule.runs.length === 0 && <p style={{ fontSize: 12, color: 'var(--ink-secondary)', margin: 0 }}>No runs recorded yet.</p>}
          {schedule.runs.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: 'var(--ink-secondary)', textAlign: 'left' }}>
                  <th style={{ fontWeight: 500, padding: '4px 0' }}>Run at</th>
                  <th style={{ fontWeight: 500, padding: '4px 0' }}>Triggered by</th>
                  <th style={{ fontWeight: 500, padding: '4px 0' }}>Result</th>
                  <th style={{ fontWeight: 500, padding: '4px 0' }}>Job</th>
                </tr>
              </thead>
              <tbody>
                {schedule.runs.map((run, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ padding: '4px 0' }}>{formatDate(run.runAt)}</td>
                    <td style={{ padding: '4px 0' }}>{run.triggeredBy}</td>
                    <td style={{ padding: '4px 0' }}>{run.status === 'success' ? 'Success' : `Failed — ${run.error || 'unknown error'}`}</td>
                    <td className="mono" style={{ padding: '4px 0' }}>{run.jobId ? run.jobId.slice(0, 8) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export default function SchedulingPage() {
  const [schedules, setSchedules] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getSchedules().then((data) => setSchedules(data.schedules)).catch((e) => setError(e.message));
  }, []);

  function handleChange(updated, deletedId) {
    setSchedules((prev) => {
      if (deletedId) return prev.filter((s) => s.id !== deletedId);
      return prev.map((s) => (s.id === updated.id ? updated : s));
    });
  }

  function handleCreated(schedule) {
    setSchedules((prev) => [...(prev || []), schedule]);
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Scheduling</h1>
      <p style={{ color: 'var(--ink-secondary)', fontSize: 14, marginBottom: 24 }}>
        Configure automated ingestion per source. A scheduled run pulls the source's file and feeds it through the
        same validation → matching → quality-summary pipeline as a manual upload.
      </p>

      <NewScheduleForm onCreated={handleCreated} />

      {error && <p style={{ color: 'var(--rejected-fg)', fontSize: 14 }}>{error}</p>}
      {!schedules && !error && <p style={{ color: 'var(--ink-secondary)', fontSize: 14 }}>Loading…</p>}
      {schedules && schedules.length === 0 && <p style={{ color: 'var(--ink-secondary)', fontSize: 14 }}>No schedules configured yet — add one above.</p>}

      {schedules && schedules.map((schedule) => (
        <ScheduleCard key={schedule.id} schedule={schedule} onChange={handleChange} />
      ))}
    </div>
  );
}
