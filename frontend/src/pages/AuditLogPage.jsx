import { useEffect, useState } from 'react';
import { getAuditLog } from '../api/client';

function formatDate(iso) {
  return new Date(iso).toLocaleString();
}

const thStyle = { textAlign: 'left', padding: '10px 16px', fontWeight: 500, color: 'var(--ink-secondary)', fontSize: 12 };
const tdStyle = { padding: '10px 16px', fontSize: 13 };

// Admin-only (route-gated in App.jsx) — makes the audit trail an actual,
// inspectable feature rather than data that only ever gets written and
// never read. Every mutation that matters (login, upload, approval,
// schedule changes, Databricks retries) lands here with a real actor —
// derived from the authenticated session server-side, not from anything
// the client claims — so this table is the honest record of who did what.
export default function AuditLogPage() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getAuditLog().then((d) => setEntries(d.entries)).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Audit log</h1>
      <p style={{ color: 'var(--ink-secondary)', fontSize: 14, marginBottom: 24 }}>
        Every recorded mutation across the system — logins, uploads, approvals, schedule changes, and ingestion retries — newest first.
      </p>

      {error && <p style={{ color: 'var(--rejected-fg)', fontSize: 14 }}>{error}</p>}
      {!entries && !error && <p style={{ color: 'var(--ink-secondary)', fontSize: 14 }}>Loading…</p>}
      {entries && entries.length === 0 && <p style={{ color: 'var(--ink-secondary)', fontSize: 14 }}>No audit entries yet.</p>}

      {entries && entries.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                <th style={thStyle}>When</th>
                <th style={thStyle}>Actor</th>
                <th style={thStyle}>Action</th>
                <th style={thStyle}>Job</th>
                <th style={thStyle}>Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i} style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <td className="mono" style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDate(e.at)}</td>
                  <td style={tdStyle}>{e.actor}</td>
                  <td style={tdStyle}>{e.action.replace(/_/g, ' ')}</td>
                  <td className="mono" style={tdStyle}>{e.jobId ? e.jobId.slice(0, 8) : '—'}</td>
                  <td style={{ ...tdStyle, color: 'var(--ink-secondary)' }}>{e.details ? JSON.stringify(e.details) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
