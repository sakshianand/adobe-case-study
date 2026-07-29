// The signature visual element of the whole product — this exact badge
// renders identically on Validation Results, Review & Approve,
// Reconciliation, and the Dashboard. The repetition IS the point: a
// reviewer should recognize "auto-applied vs suggested vs rejected"
// without reading a label, on any screen, every time.

const VARIANTS = {
  verified: { bg: 'var(--verified-bg)', fg: 'var(--verified-fg)', icon: '✓', label: 'Auto-applied' },
  review: { bg: 'var(--review-bg)', fg: 'var(--review-fg)', icon: '◐', label: 'Suggested' },
  rejected: { bg: 'var(--rejected-bg)', fg: 'var(--rejected-fg)', icon: '✕', label: 'Excluded' },
};

export default function StatusBadge({ variant, confidence, label }) {
  const v = VARIANTS[variant];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: v.bg,
        color: v.fg,
        fontSize: 12,
        fontWeight: 500,
        padding: '4px 10px',
        borderRadius: 999,
        fontFamily: confidence !== undefined ? undefined : 'var(--font-display)',
      }}
    >
      <span aria-hidden="true">{v.icon}</span>
      <span>{label || v.label}</span>
      {confidence !== undefined && (
        <span className="mono" style={{ fontWeight: 600 }}>{confidence}%</span>
      )}
    </span>
  );
}