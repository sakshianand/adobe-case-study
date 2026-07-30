import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { pollJob, uploadFile, approveJob, pollPushStatus, getReconciliation, pollIngestionStatus, retryDatabricksIngestion, getDatabricksStatus } from '../api/client';
import { useJob } from '../context/JobContext';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';
import MetricCard from '../components/MetricCard';
import JobProgress from '../components/JobProgress';

function Row({ icon, title, detail, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '0.5px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 14, margin: 0 }}>{title}</p>
        <p className="mono" style={{ fontSize: 12, color: 'var(--ink-secondary)', margin: '2px 0 0' }}>{detail}</p>
      </div>
      {children}
    </div>
  );
}

const btnStyle = { fontSize: 12, fontWeight: 500, background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 12px' };

export default function ReviewPage() {
  const [params] = useSearchParams();
  const jobId = params.get('job');
  const [job, setJob] = useState(null);
  // rowKey -> 'approved' | 'rejected' | { action, correctedName } (inline-edited before approving)
  const [decisions, setDecisions] = useState({});
  const [edits, setEdits] = useState({}); // rowKey -> in-progress edited name, before it's committed to a decision
  const [bulkThreshold, setBulkThreshold] = useState(90);
  const [advancing, setAdvancing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [pushStatus, setPushStatus] = useState(null); // null | 'pushing' | 'success' | 'failed'
  const [pushResult, setPushResult] = useState(null);
  const [ingestionStatus, setIngestionStatus] = useState(null); // null | 'pending' | 'ingesting' | 'success' | 'failed'
  const [ingestionAttempts, setIngestionAttempts] = useState([]);
  const [retrying, setRetrying] = useState(false);
  const [audit, setAudit] = useState([]);
  const [reconciliation, setReconciliation] = useState(null);
  const navigate = useNavigate();
  const { queue, takeNextFromQueue, setJobId } = useJob();
  const { user } = useAuth();
  const canApprove = user?.role === 'approver' || user?.role === 'admin';

  useEffect(() => {
    if (!jobId) return;
    return pollJob(jobId, setJob);
  }, [jobId]);

  useEffect(() => {
    if (!jobId || job?.status !== 'complete') return;
    let cancelled = false;
    getReconciliation(jobId).then((r) => { if (!cancelled) setReconciliation(r); }).catch(() => {});
    return () => { cancelled = true; };
  }, [jobId, job?.status]);

  // A job already approved & pushed in a prior session/page-load still
  // carries pushStatus/pushResult on the job record itself (jobStore.js
  // persists it) — hydrate local state from that the first time it's seen
  // so reloading this page doesn't show a stale "Approve & push" button
  // for a job that was already pushed.
  useEffect(() => {
    if (job?.pushStatus && pushStatus === null) {
      setPushStatus(job.pushStatus);
      setPushResult(job.pushResult);
    }
    if (job?.ingestionStatus && ingestionStatus === null) {
      setIngestionStatus(job.ingestionStatus);
      setIngestionAttempts(job.ingestionAttempts || []);
    }
  }, [job]);

  const refreshAudit = async () => {
    try {
      const status = await getDatabricksStatus(jobId);
      setAudit(status.audit || []);
    } catch (e) { /* audit trail is best-effort display, not load-bearing */ }
  };

  useEffect(() => {
    if (ingestionStatus === 'success' || ingestionStatus === 'failed') refreshAudit();
  }, [ingestionStatus]);

  // Ad Platform push AND Databricks ingestion (both bonus features):
  // committing decisions via POST /approve triggers both server-side.
  // job.status settles at 'complete' long before either does, so once
  // approval is submitted this switches to polling pushStatus/ingestionStatus
  // specifically until each reaches its own terminal state.
  const approveAndPush = async () => {
    setApproving(true);
    setPushStatus('pushing');
    setIngestionStatus('pending');
    try {
      await approveJob(jobId, decisions);
      pollPushStatus(jobId, (updatedJob) => {
        setPushStatus(updatedJob.pushStatus);
        setPushResult(updatedJob.pushResult);
      });
      pollIngestionStatus(jobId, (updatedJob) => {
        setIngestionStatus(updatedJob.ingestionStatus);
        setIngestionAttempts(updatedJob.ingestionAttempts || []);
      });
    } catch (e) {
      setPushStatus('failed');
      setPushResult({ error: e.message });
    } finally {
      setApproving(false);
    }
  };

  const retryIngestion = async () => {
    setRetrying(true);
    try {
      const result = await retryDatabricksIngestion(jobId);
      setIngestionStatus(result.ingestionStatus);
      pollIngestionStatus(jobId, (updatedJob) => {
        setIngestionStatus(updatedJob.ingestionStatus);
        setIngestionAttempts(updatedJob.ingestionAttempts || []);
      });
      await refreshAudit();
    } finally {
      setRetrying(false);
    }
  };

  // Only reachable once this job is done — advances the queue by one file
  // and repeats the same upload -> validate -> review cycle for it.
  // Keeps the sequential-processing model explicit in the code, matching
  // what the staging screen tells the user will happen.
  const processNext = async () => {
    const next = takeNextFromQueue();
    if (!next) {
      navigate('/upload');
      return;
    }
    setAdvancing(true);
    try {
      const result = await uploadFile(next);
      setJobId(result.jobId);
      navigate(`/validation?job=${result.jobId}`);
    } catch (e) {
      setAdvancing(false);
    }
  };

  if (!jobId) return <p style={{ color: 'var(--ink-secondary)', fontSize: 14 }}>No active run. Start from Upload.</p>;
  if (!job || !job.validationSummary) return <p style={{ color: 'var(--ink-secondary)', fontSize: 14 }}>Loading…</p>;

  const s = job.validationSummary;
  const matches = job.matches || [];
  const suggestMatches = matches.filter((m) => m.action === 'suggest');

  const decide = (key, action) => {
    const editedName = edits[key];
    setDecisions((d) => ({
      ...d,
      [key]: editedName ? { action, correctedName: editedName } : action,
    }));
  };

  const decisionAction = (key) => {
    const d = decisions[key];
    return typeof d === 'object' ? d.action : d;
  };

  const acceptAboveThreshold = () => {
    setDecisions((d) => {
      const next = { ...d };
      for (const m of suggestMatches) {
        const key = `match-${m.row}`;
        if (m.confidence >= bulkThreshold && !next[key]) {
          const editedName = edits[key];
          next[key] = editedName ? { action: 'approved', correctedName: editedName } : 'approved';
        }
      }
      return next;
    });
  };

  const downloadErrorReport = () => {
    const rows = [['Row', 'Type', 'Detail']];
    s.schemaIssues.forEach((i) => rows.push([i.row, `schema (${i.stage})`, i.reason || i.message || JSON.stringify(i)]));
    s.dateFlags.forEach((f) => rows.push([f.row, 'date flag', `raw value "${f.raw}" — ${f.reason}`]));
    s.duplicates.campaignIds.forEach((d) => rows.push([d.row, 'duplicate campaign ID', d.campaignId]));
    s.duplicates.rowHashes.forEach((d) => rows.push([d.row, 'duplicate row', d.hash]));

    const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `error-report-${jobId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>AI suggestions & review</h1>
      <p style={{ color: 'var(--ink-secondary)', fontSize: 14, marginBottom: 24 }}>
        Deterministic corrections are applied automatically. Anything AI-suggested waits for your approval.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 24 }}>
        <MetricCard label="Total records" value={s.totalRows} />
        <MetricCard label="Passed" value={s.cleanRows} />
        <MetricCard label="Warnings" value={s.needsReview} />
        <MetricCard label="Failed" value={s.rejected} />
      </div>

      {job.status !== 'complete' && <JobProgress status={job.status} />}

      {reconciliation && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <p style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>Spend reconciliation summary</p>
            <Link to={`/reconciliation`} style={{ fontSize: 13, color: 'var(--brand)' }}>View full reconciliation →</Link>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12 }}>
            <MetricCard label="Matched" value={reconciliation.summary.matched} />
            <MetricCard label="Needs review" value={reconciliation.summary.review} />
            <MetricCard label="Unmatched (upload)" value={reconciliation.summary.unmatchedUpload} />
            <MetricCard label="Unmatched (platform)" value={reconciliation.summary.unmatchedPlatform} />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 15, fontWeight: 500, margin: 0 }}>Rows needing review</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 13, color: 'var(--ink-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
            Confidence ≥
            <input
              type="number"
              min="0"
              max="100"
              value={bulkThreshold}
              onChange={(e) => setBulkThreshold(Number(e.target.value))}
              style={{ width: 52, fontSize: 13, padding: '4px 6px', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
            />
            %
          </label>
          {canApprove && <button style={btnStyle} onClick={acceptAboveThreshold}>Accept all above threshold</button>}
          <button style={btnStyle} onClick={downloadErrorReport}>Download error report</button>
        </div>
      </div>

      <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
        {suggestMatches.map((m) => {
          const key = `match-${m.row}`;
          const action = decisionAction(key);
          const editValue = edits[key] ?? m.matchedName;
          return (
            <Row key={key} title="Campaign name match" detail={`${m.uploadedName} → row ${m.row}`}>
              {action ? (
                <StatusBadge variant={action === 'approved' ? 'verified' : 'rejected'} label={action === 'approved' ? `Approved (${editValue})` : 'Rejected'} />
              ) : canApprove ? (
                <>
                  <StatusBadge variant="review" confidence={m.confidence} />
                  <input
                    value={editValue}
                    onChange={(e) => setEdits((ed) => ({ ...ed, [key]: e.target.value }))}
                    style={{ fontSize: 12, padding: '5px 8px', border: '0.5px solid var(--border)', borderRadius: 'var(--radius-sm)', marginLeft: 8, width: 160 }}
                  />
                  <button style={{ ...btnStyle, marginLeft: 8 }} onClick={() => decide(key, 'approved')}>Approve</button>
                  <button style={btnStyle} onClick={() => decide(key, 'rejected')}>Reject</button>
                </>
              ) : (
                // Read-only for non-approvers: staging a decision they have no way
                // to push is just confusing UX, not a useful preparatory step.
                <StatusBadge variant="review" label={`Suggested: ${m.matchedName}`} confidence={m.confidence} />
              )}
            </Row>
          );
        })}

        {s.dateFlags.map((f) => (
          <Row key={`date-${f.row}`} title="Date flagged" detail={`row ${f.row} · raw value "${f.raw}"`}>
            <StatusBadge variant="review" label="Needs input" />
          </Row>
        ))}

        {s.duplicates.campaignIds.map((d) => (
          <Row key={`dup-${d.row}`} title="Duplicate campaign ID" detail={`row ${d.row} · ${d.campaignId}`}>
            <StatusBadge variant="review" label="Needs decision" />
          </Row>
        ))}

        {s.businessRuleCorrections.map((c) => (
          <Row key={`corr-${c.row}-${c.field}`} title={`${c.field} normalized`} detail={`row ${c.row} · ${c.original} → ${c.correctedValue}`}>
            <StatusBadge variant="verified" />
          </Row>
        ))}
      </div>

      {job.status === 'complete' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div>
                {pushStatus === 'pushing' && <StatusBadge variant="review" label="Pushing to Google Ads…" />}
                {pushStatus === 'success' && (
                  <StatusBadge variant="verified" label={`Pushed · batch ${pushResult?.platformBatchId}`} />
                )}
                {pushStatus === 'failed' && (
                  <StatusBadge variant="rejected" label={pushResult?.error || 'Push failed'} />
                )}
                {pushStatus === null && canApprove && (
                  <button onClick={approveAndPush} disabled={approving} style={btnStyle}>
                    Approve & push to Ad Platform
                  </button>
                )}
                {pushStatus === null && !canApprove && (
                  <StatusBadge variant="review" label="Waiting for an approver" />
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {(ingestionStatus === 'pending' || ingestionStatus === 'ingesting') && (
                  <StatusBadge variant="review" label="Ingesting to Databricks…" />
                )}
                {ingestionStatus === 'success' && (
                  <StatusBadge variant="verified" label={`Databricks ingested · ${ingestionAttempts.length || 1} attempt(s)`} />
                )}
                {ingestionStatus === 'failed' && (
                  <>
                    <StatusBadge variant="rejected" label={`Databricks ingestion failed (${ingestionAttempts.length} attempts)`} />
                    {canApprove && (
                      <button onClick={retryIngestion} disabled={retrying} style={btnStyle}>
                        {retrying ? 'Retrying…' : 'Retry ingestion'}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
            <button
              onClick={processNext}
              disabled={advancing}
              style={{ background: 'var(--brand)', color: 'white', border: 'none', fontSize: 13, fontWeight: 500, padding: '10px 20px', borderRadius: 'var(--radius-sm)' }}
            >
              {advancing
                ? 'Starting next file…'
                : queue.length > 0
                  ? `Process next file (${queue.length} remaining) →`
                  : 'Done — back to upload'}
            </button>
          </div>

          {audit.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <p style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>Audit trail</p>
              <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                {audit.map((entry, i) => (
                  <Row
                    key={i}
                    title={entry.action.replace(/_/g, ' ')}
                    detail={`${entry.actor} · ${new Date(entry.at).toLocaleString()}${entry.details?.error ? ` · ${entry.details.error}` : ''}`}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}