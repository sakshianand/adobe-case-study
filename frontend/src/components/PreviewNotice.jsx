// Honest labeling, not a fake "it works" state — these three screens'
// backends aren't built yet (Reconciliation service, /pipeline-status,
// /history). Says so plainly rather than showing static data that looks
// live, which is what "annotated wireframes are acceptable" in the brief
// is asking for on the pieces that don't have time to be fully wired.
export default function PreviewNotice({ children }) {
  return (
    <div style={{ background: 'var(--review-bg)', color: 'var(--review-fg)', fontSize: 12, padding: '8px 12px', borderRadius: 'var(--radius-sm)', marginBottom: 20, display: 'inline-block' }}>
      Preview — {children}
    </div>
  );
}