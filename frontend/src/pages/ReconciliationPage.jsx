import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useJob } from '../context/JobContext';
import { getReconciliation } from '../api/client';
import MetricCard from '../components/MetricCard';
import StatusBadge from '../components/StatusBadge';
import PreviewNotice from '../components/PreviewNotice';

const STATUS_META = {
  match: { variant: 'verified', label: 'Match' },
  review: { variant: 'review', label: 'Review' },
  unmatched_upload: { variant: 'rejected', label: 'Unmatched (upload only)' },
  unmatched_platform: { variant: 'rejected', label: 'Unmatched (platform only)' },
};

function money(n) {
  return n === null ? '—' : `$${n.toLocaleString()}`;
}

export default function ReconciliationPage() {
  const [params] = useSearchParams();
  // ?job=<id> lets any job be opened directly (e.g. from Pipeline Status
  // or the Review page's "View full reconciliation" link) — falls back to
  // JobContext's jobId only when there's no explicit job in the URL, e.g.
  // navigating here straight from the sidebar right after an upload.
  const { jobId: activeJobId } = useJob();
  const jobId = params.get('job') || activeJobId;
  const [thresholdPct, setThresholdPct] = useState(5);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getReconciliation(jobId, thresholdPct / 100)
      .then((r) => { if (!cancelled) setReport(r); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [jobId, thresholdPct]);

  if (!jobId) {
    return (
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}>Spend reconciliation</h1>
        <PreviewNotice>Start an upload first — reconciliation compares a run's uploaded spend against ad platform actuals.</PreviewNotice>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Spend reconciliation</h1>
        <label style={{ fontSize: 13, color: 'var(--ink-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
          Variance threshold
          <input
            type="number"
            min="0"
            step="0.5"
            value={thresholdPct}
            onChange={(e) => setThresholdPct(Number(e.target.value))}
            style={{ width: 56, fontSize: 13, padding: '4px 6px', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
          />
          %
        </label>
      </div>
      <p style={{ color: 'var(--ink-secondary)', fontSize: 14, marginBottom: 24 }}>
        Uploaded spend vs. {report ? report.platform : 'ad platform'}-reported spend for this run's campaigns.
      </p>

      {loading && <p style={{ fontSize: 14, color: 'var(--ink-secondary)' }}>Reconciling…</p>}
      {error && <PreviewNotice>{error}</PreviewNotice>}

      {report && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 24 }}>
            <MetricCard label="Matched" value={report.summary.matched} />
            <MetricCard label="Needs review" value={report.summary.review} />
            <MetricCard label="Unmatched (upload)" value={report.summary.unmatchedUpload} />
            <MetricCard label="Unmatched (platform)" value={report.summary.unmatchedPlatform} />
          </div>

          <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 500, color: 'var(--ink-secondary)' }}>Campaign</th>
                  <th style={{ textAlign: 'right', padding: '10px 16px', fontWeight: 500, color: 'var(--ink-secondary)' }}>Uploaded Spend</th>
                  <th style={{ textAlign: 'right', padding: '10px 16px', fontWeight: 500, color: 'var(--ink-secondary)' }}>Platform Reported</th>
                  <th style={{ textAlign: 'right', padding: '10px 16px', fontWeight: 500, color: 'var(--ink-secondary)' }}>Variance</th>
                  <th style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 500, color: 'var(--ink-secondary)' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => {
                  const meta = STATUS_META[r.status];
                  return (
                    <tr key={r.campaign} style={{ borderBottom: '0.5px solid var(--border)' }}>
                      <td style={{ padding: '10px 16px' }}>{r.campaign}</td>
                      <td className="mono" style={{ padding: '10px 16px', textAlign: 'right' }}>{money(r.uploadedSpend)}</td>
                      <td className="mono" style={{ padding: '10px 16px', textAlign: 'right' }}>{money(r.reportedSpend)}</td>
                      <td className="mono" style={{ padding: '10px 16px', textAlign: 'right' }}>{r.variance === null ? '—' : `${r.variance}%`}</td>
                      <td style={{ padding: '10px 16px' }}>
                        <StatusBadge variant={meta.variant} label={meta.label} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
