// Stepped, not smooth/animated — the backend only reports three discrete
// states (processing -> matching -> complete), so a segmented bar that
// fills as real stages complete is honest; a continuously-animated percent
// bar would imply row-by-row granularity we don't actually have.
const STAGES = [
  { key: 'processing', label: 'Validating' },
  { key: 'matching', label: 'Matching campaigns' },
  { key: 'complete', label: 'Complete' },
];

export default function JobProgress({ status }) {
  const currentIndex = STAGES.findIndex((s) => s.key === status);
  const isFailed = status === 'failed';

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {STAGES.map((stage, i) => {
          const done = !isFailed && i < currentIndex;
          const active = !isFailed && i === currentIndex;
          const failed = isFailed && i === Math.max(currentIndex, 0);
          return (
            <div
              key={stage.key}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                background: failed ? 'var(--rejected-fg)' : done || active ? 'var(--brand)' : 'var(--border)',
                opacity: active ? 0.6 : 1,
                transition: 'background 0.2s',
              }}
            />
          );
        })}
      </div>
      <p style={{ fontSize: 13, color: isFailed ? 'var(--rejected-fg)' : 'var(--ink-secondary)', margin: 0 }}>
        {isFailed
          ? 'Something went wrong processing this file.'
          : status === 'complete'
            ? 'Done — all stages complete.'
            : `${STAGES[currentIndex]?.label ?? 'Starting'}…`}
      </p>
    </div>
  );
}