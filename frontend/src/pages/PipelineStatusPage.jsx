import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPipelineStatus } from '../api/client';
import StatusBadge from '../components/StatusBadge';

const PUSH_STATUS_META = {
  not_started: { variant: 'rejected', label: 'Not pushed' },
  pushing: { variant: 'review', label: 'Pushing…' },
  success: { variant: 'verified', label: 'Pushed' },
  failed: { variant: 'rejected', label: 'Push failed' },
};

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleString() : '—';
}

export default function PipelineStatusPage() {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      try {
        const data = await getPipelineStatus();
        if (!cancelled) setJobs(data.jobs);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
      if (!cancelled) setTimeout(tick, 2000);
    }

    tick();
    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Pipeline status</h1>
      <p style={{ color: 'var(--ink-secondary)', fontSize: 14, marginBottom: 24 }}>
        Current and historical state across every ingestion run this server has processed, including Ad Platform push status.
      </p>

      {error && <p style={{ color: 'var(--rejected-fg)', fontSize: 14 }}>{error}</p>}
      {!jobs && !error && <p style={{ color: 'var(--ink-secondary)', fontSize: 14 }}>Loading…</p>}
      {jobs && jobs.length === 0 && <p style={{ color: 'var(--ink-secondary)', fontSize: 14 }}>No runs yet — start from Upload.</p>}

      {jobs && jobs.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 500, color: 'var(--ink-secondary)' }}>File</th>
                <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 500, color: 'var(--ink-secondary)' }}>Started</th>
                <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 500, color: 'var(--ink-secondary)' }}>Status</th>
                <th style={{ textAlign: 'right', padding: '10px 16px', fontWeight: 500, color: 'var(--ink-secondary)' }}>Quality</th>
                <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 500, color: 'var(--ink-secondary)' }}>Ad Platform push</th>
                <th style={{ padding: '10px 16px' }} />
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const pushMeta = PUSH_STATUS_META[job.pushStatus] || PUSH_STATUS_META.not_started;
                return (
                  <tr key={job.jobId} style={{ borderBottom: '0.5px solid var(--border)' }}>
                    <td style={{ padding: '10px 16px' }}>{job.fileName || '—'}</td>
                    <td className="mono" style={{ padding: '10px 16px', fontSize: 12 }}>{formatDate(job.createdAt)}</td>
                    <td style={{ padding: '10px 16px' }}>{job.status}</td>
                    <td className="mono" style={{ padding: '10px 16px', textAlign: 'right' }}>
                      {job.qualityScore !== null ? `${job.qualityScore}%` : '—'}
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <StatusBadge
                        variant={pushMeta.variant}
                        label={job.pushStatus === 'success' && job.pushResult?.platformBatchId
                          ? `Pushed · ${job.pushResult.platformBatchId}`
                          : job.pushStatus === 'failed' && job.pushResult?.error
                            ? job.pushResult.error
                            : pushMeta.label}
                      />
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                      {job.status === 'complete' && (
                        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                          <Link to={`/review?job=${job.jobId}`} style={{ fontSize: 12, color: 'var(--brand)' }}>
                            {job.approved ? 'View →' : 'Review →'}
                          </Link>
                          <Link to={`/reconciliation?job=${job.jobId}`} style={{ fontSize: 12, color: 'var(--brand)' }}>
                            Reconciliation →
                          </Link>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
