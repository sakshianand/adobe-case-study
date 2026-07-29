import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { pollJob } from '../api/client';
import MetricCard from '../components/MetricCard';
import JobProgress from '../components/JobProgress';

export default function ValidationResultsPage() {
  const [params] = useSearchParams();
  const jobId = params.get('job');
  const [job, setJob] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!jobId) return;
    const cancel = pollJob(jobId, setJob);
    return cancel;
  }, [jobId]);

  if (!jobId) {
    return <p style={{ color: 'var(--ink-secondary)', fontSize: 14 }}>No active run. Start from Upload.</p>;
  }
  if (!job || !job.validationSummary) {
    return (
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 20 }}>Validation results</h1>
        <JobProgress status={job?.status || 'processing'} />
      </div>
    );
  }

  const s = job.validationSummary;

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Validation results</h1>
      <p className="mono" style={{ color: 'var(--ink-secondary)', fontSize: 12, marginBottom: 20 }}>job {jobId}</p>

      {job.status !== 'complete' && <JobProgress status={job.status} />}


      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 24 }}>
        <MetricCard label="Quality score" value={`${s.qualityScore}%`} />
        <MetricCard label="Processed" value={s.processed} />
        <MetricCard label="Needs review" value={s.needsReview} />
        <MetricCard label="Rejected" value={s.rejected} />
      </div>

      <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 24 }}>
        <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>Issue breakdown</p>
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, margin: 0, fontSize: 13 }}>
          <div><dt style={{ color: 'var(--ink-secondary)', fontSize: 12 }}>Schema issues</dt><dd className="mono" style={{ margin: '4px 0 0' }}>{s.schemaIssues.length}</dd></div>
          <div><dt style={{ color: 'var(--ink-secondary)', fontSize: 12 }}>Date flags</dt><dd className="mono" style={{ margin: '4px 0 0' }}>{s.dateFlags.length}</dd></div>
          <div><dt style={{ color: 'var(--ink-secondary)', fontSize: 12 }}>Corrections</dt><dd className="mono" style={{ margin: '4px 0 0' }}>{s.businessRuleCorrections.length}</dd></div>
          <div><dt style={{ color: 'var(--ink-secondary)', fontSize: 12 }}>Duplicates</dt><dd className="mono" style={{ margin: '4px 0 0' }}>{s.duplicates.campaignIds.length + s.duplicates.rowHashes.length}</dd></div>
        </dl>
      </div>

      <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 24 }}>
        <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>AI quality summary</p>
        {job.status !== 'complete' ? (
          <p style={{ fontSize: 13, color: 'var(--ink-secondary)', margin: 0 }}>Generating…</p>
        ) : job.qualitySummary ? (
          <p style={{ fontSize: 14, margin: 0, lineHeight: 1.5 }}>{job.qualitySummary}</p>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--ink-secondary)', margin: 0 }}>Summary unavailable for this run.</p>
        )}
      </div>

      <button
        onClick={() => navigate(`/review?job=${jobId}`)}
        style={{ background: 'var(--brand)', color: 'white', border: 'none', fontSize: 13, fontWeight: 500, padding: '10px 20px', borderRadius: 'var(--radius-sm)' }}
      >
        Continue to AI Suggestions & Review →
      </button>
    </div>
  );
}