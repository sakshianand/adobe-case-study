import { NavLink, Outlet } from 'react-router-dom';
import ChatWidget from './ChatWidget';
import { useJob } from '../context/JobContext';
import { useAuth } from '../context/AuthContext';

// The stepper mirrors the case study's own suggested page flow directly —
// this is a real sequence a user moves through per ingestion run, so a
// numbered/ordered nav is earning its place here, not decorating.
// `needsJob: true` steps are only reachable once a run exists — clicking
// them cold with no job in progress isn't a real path through the product.
// `roles` restricts a step to the roles listed — undefined means every
// authenticated role can see it. This is UX only: hiding a nav link isn't
// what stops an uploader from calling POST /schedules directly, the
// requireRole middleware on the backend is (see middleware/auth.js).
const STEPS = [
  { path: '/upload', label: 'Upload', needsJob: false },
  { path: '/validation', label: 'Validation Results', needsJob: true },
  { path: '/review', label: 'AI Suggestions & Review', needsJob: true },
  { path: '/reconciliation', label: 'Spend Reconciliation', needsJob: false },
  { path: '/status', label: 'Pipeline Status', needsJob: false },
  { path: '/scheduling', label: 'Scheduling', needsJob: false, roles: ['admin'] },
  { path: '/dashboard', label: 'Dashboard', needsJob: false },
  { path: '/audit', label: 'Audit Log', needsJob: false, roles: ['admin'] },
];

export default function Layout() {
  const { jobId } = useJob();
  const { user, logout } = useAuth();
  const visibleSteps = STEPS.filter((step) => !step.roles || step.roles.includes(user?.role));

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside
        style={{
          width: 240,
          borderRight: '0.5px solid var(--border)',
          background: 'var(--surface)',
          padding: '24px 16px',
          flexShrink: 0,
          // sticky + viewport height, not absolute-inside-relative: the
          // sidebar's own content is short, but <main> (e.g. the Dashboard)
          // can be much taller, which stretches this flex sibling's box far
          // past one screen. An absolutely-positioned "bottom: 24" child
          // was anchoring to THAT full stretched height, not the viewport —
          // it rendered, just scrolled thousands of pixels below the fold.
          // Sticky + a fixed viewport height keeps this whole column, user
          // badge included, pinned to what's actually visible.
          position: 'sticky',
          top: 0,
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', marginBottom: 32 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--brand)' }} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>Marketing Ingestion</span>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {visibleSteps.map((step, i) => {
            const locked = step.needsJob && !jobId;
            const to = step.needsJob && jobId ? `${step.path}?job=${jobId}` : step.path;

            if (locked) {
              return (
                <div
                  key={step.path}
                  title="Start an upload first"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 8px',
                    fontSize: 13,
                    color: 'var(--border)',
                    cursor: 'not-allowed',
                  }}
                >
                  <span className="mono" style={{ fontSize: 11, width: 16 }}>{String(i + 1).padStart(2, '0')}</span>
                  {step.label}
                </div>
              );
            }

            return (
              <NavLink
                key={step.path}
                to={to}
                style={({ isActive }) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 8px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                  textDecoration: 'none',
                  color: isActive ? 'var(--brand)' : 'var(--ink-secondary)',
                  background: isActive ? '#EEF0FA' : 'transparent',
                  fontWeight: isActive ? 500 : 400,
                })}
              >
                <span className="mono" style={{ fontSize: 11, width: 16 }}>{String(i + 1).padStart(2, '0')}</span>
                {step.label}
              </NavLink>
            );
          })}
        </nav>

        {user && (
          <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '0.5px solid var(--border)' }}>
            <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>{user.username}</p>
            <p style={{ fontSize: 11, color: 'var(--ink-secondary)', margin: '2px 0 8px', textTransform: 'capitalize' }}>{user.role}</p>
            <button
              onClick={logout}
              style={{ fontSize: 12, padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '0.5px solid var(--border)', background: 'var(--bg)', cursor: 'pointer' }}
            >
              Sign out
            </button>
          </div>
        )}
      </aside>

      <main style={{ flex: 1, padding: '32px 40px', maxWidth: 960 }}>
        <Outlet />
      </main>

      <ChatWidget />
    </div>
  );
}