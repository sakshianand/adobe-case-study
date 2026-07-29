import { useEffect, useState } from 'react';
import { getDashboard } from '../api/client';
import MetricCard from '../components/MetricCard';

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleString() : '—';
}

function formatMs(ms) {
  if (ms === null || ms === undefined) return '—';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function pct(n) {
  return n === null || n === undefined ? '—' : `${n}%`;
}

const sectionStyle = { background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 24 };
const sectionTitleStyle = { fontSize: 14, fontWeight: 600, margin: '0 0 12px' };
const thStyle = { textAlign: 'left', padding: '6px 0', fontWeight: 500, color: 'var(--ink-secondary)', fontSize: 12 };
const tdStyle = { padding: '6px 0', fontSize: 13 };

// Hand-rolled instead of pulling in a chart library — this is the only
// "trend" this dashboard needs, and a dependency-free SVG polyline is
// simpler to reason about than wiring up a charting lib for one sparkline.
function QualitySparkline({ points }) {
  if (points.length < 2) {
    return <p style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>Need at least two runs to show a trend.</p>;
  }

  const width = 600;
  const height = 80;
  const padding = 8;
  const step = (width - padding * 2) / (points.length - 1);

  const coords = points.map((p, i) => {
    const x = padding + i * step;
    const y = padding + (1 - p.qualityScore / 100) * (height - padding * 2);
    return { x, y, ...p };
  });

  const path = coords.map((c) => `${c.x},${c.y}`).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height }} preserveAspectRatio="none">
      <polyline points={path} fill="none" stroke="var(--brand)" strokeWidth="2" />
      {coords.map((c) => (
        <circle key={c.jobId} cx={c.x} cy={c.y} r="3" fill="var(--brand)">
          <title>{`${c.fileName || c.jobId} — ${c.qualityScore}% (${formatDate(c.createdAt)})`}</title>
        </circle>
      ))}
    </svg>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      try {
        const d = await getDashboard();
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
      if (!cancelled) setTimeout(tick, 5000);
    }

    tick();
    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Dashboard</h1>
      <p style={{ color: 'var(--ink-secondary)', fontSize: 14, marginBottom: 24 }}>
        Aggregated view across every ingestion run this server has processed.
      </p>

      {error && <p style={{ color: 'var(--rejected-fg)', fontSize: 14 }}>{error}</p>}
      {!data && !error && <p style={{ color: 'var(--ink-secondary)', fontSize: 14 }}>Loading…</p>}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12, marginBottom: 24 }}>
            <MetricCard label="Files processed" value={data.totals.processed} />
            <MetricCard label="Successful" value={data.totals.successful} />
            <MetricCard label="Failed" value={data.totals.failed} />
            <MetricCard label="In progress" value={data.totals.inProgress} />
          </div>

          <div style={sectionStyle}>
            <p style={sectionTitleStyle}>Data quality score trend</p>
            <QualitySparkline points={data.qualityTrend} />
            {data.qualityTrend.length === 0 && <p style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>No completed runs yet.</p>}
          </div>

          <div style={sectionStyle}>
            <p style={sectionTitleStyle}>Pipeline health</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12 }}>
              <MetricCard label="Success rate" value={pct(data.pipelineHealth.successRate)} />
              <MetricCard label="Avg. processing latency" value={formatMs(data.pipelineHealth.avgLatencyMs)} />
              <MetricCard label="Runs measured" value={data.pipelineHealth.recentLatencies.length} />
            </div>
            {data.pipelineHealth.recentLatencies.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
                <thead>
                  <tr><th style={thStyle}>File</th><th style={thStyle}>Latency</th></tr>
                </thead>
                <tbody>
                  {data.pipelineHealth.recentLatencies.map((r) => (
                    <tr key={r.jobId}><td className="mono" style={tdStyle}>{r.fileName || r.jobId.slice(0, 8)}</td><td className="mono" style={tdStyle}>{formatMs(r.latencyMs)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div style={sectionStyle}>
            <p style={sectionTitleStyle}>Spend reconciliation pass rate by platform</p>
            <p style={{ fontSize: 12, color: 'var(--ink-secondary)', marginTop: -8, marginBottom: 12 }}>
              Grouped by each upload's own platform field. The "reported spend" side of every comparison currently
              comes from a single stubbed Ad Tech client (see Reconciliation), so this reflects pass rate per
              upload source, not per Ad Tech API.
            </p>
            {data.reconciliationByPlatform.length === 0 && <p style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>No reconciled runs yet.</p>}
            {data.reconciliationByPlatform.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Platform</th>
                    <th style={thStyle}>Runs reconciled</th>
                    <th style={thStyle}>Matched</th>
                    <th style={thStyle}>Review</th>
                    <th style={thStyle}>Unmatched</th>
                    <th style={thStyle}>Pass rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.reconciliationByPlatform.map((r) => (
                    <tr key={r.platform}>
                      <td style={tdStyle}>{r.platform}</td>
                      <td className="mono" style={tdStyle}>{r.jobsReconciled}</td>
                      <td className="mono" style={tdStyle}>{r.matched}</td>
                      <td className="mono" style={tdStyle}>{r.review}</td>
                      <td className="mono" style={tdStyle}>{r.unmatchedUpload + r.unmatchedPlatform}</td>
                      <td className="mono" style={tdStyle}>{pct(r.passRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div style={sectionStyle}>
            <p style={sectionTitleStyle}>AI campaign-name corrections</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12 }}>
              <MetricCard label="Suggested" value={data.aiCorrections.suggested} />
              <MetricCard label="Approved" value={data.aiCorrections.approved} />
              <MetricCard label="Rejected" value={data.aiCorrections.rejected} />
              <MetricCard label="Acceptance rate" value={pct(data.aiCorrections.acceptanceRate)} />
            </div>
          </div>

          <div style={sectionStyle}>
            <p style={sectionTitleStyle}>RAG assistant query history</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12, marginBottom: 12 }}>
              <MetricCard label="Total queries" value={data.ragQueryHistory.totalQueries} />
              <MetricCard label="Structured" value={data.ragQueryHistory.structuredCount} />
              <MetricCard label="Semantic" value={data.ragQueryHistory.semanticCount} />
            </div>
            {data.ragQueryHistory.recent.length === 0 && <p style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>No questions asked yet — try the assistant.</p>}
            {data.ragQueryHistory.recent.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr><th style={thStyle}>Asked</th><th style={thStyle}>Question</th><th style={thStyle}>Route</th></tr>
                </thead>
                <tbody>
                  {data.ragQueryHistory.recent.map((q) => (
                    <tr key={q.id}>
                      <td className="mono" style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDate(q.at)}</td>
                      <td style={tdStyle}>{q.message}</td>
                      <td style={tdStyle}>{q.route}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
