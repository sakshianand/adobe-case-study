export default function MetricCard({ label, value }) {
  return (
    <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', padding: 16 }}>
      <p style={{ fontSize: 12, color: 'var(--ink-secondary)', margin: '0 0 6px' }}>{label}</p>
      <p className="mono" style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>{value}</p>
    </div>
  );
}