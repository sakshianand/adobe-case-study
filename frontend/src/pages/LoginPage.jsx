import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getDemoAccounts } from '../api/client';

const inputStyle = {
  fontSize: 14,
  padding: '10px 12px',
  border: '0.5px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  width: '100%',
  boxSizing: 'border-box',
};

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [demoAccounts, setDemoAccounts] = useState([]);

  useEffect(() => {
    getDemoAccounts().then((d) => setDemoAccounts(d.accounts)).catch(() => {});
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(username, password);
      const redirectTo = location.state?.from || '/upload';
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ width: 360, background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', padding: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--brand)' }} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>Marketing Ingestion</span>
        </div>

        <h1 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 4px' }}>Sign in</h1>
        <p style={{ fontSize: 13, color: 'var(--ink-secondary)', margin: '0 0 20px' }}>
          Access is role-gated — what you can do next depends on your account's role.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--ink-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} style={inputStyle} autoFocus />
          </label>
          <label style={{ fontSize: 12, color: 'var(--ink-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
          </label>

          {error && <p style={{ color: 'var(--rejected-fg)', fontSize: 13, margin: 0 }}>{error}</p>}

          <button
            type="submit"
            disabled={submitting || !username || !password}
            style={{
              fontSize: 14,
              fontWeight: 500,
              padding: '10px 14px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: 'var(--brand)',
              color: '#fff',
              cursor: submitting ? 'default' : 'pointer',
              opacity: submitting || !username || !password ? 0.6 : 1,
              marginTop: 4,
            }}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {demoAccounts.length > 0 && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '0.5px solid var(--border)' }}>
            <p style={{ fontSize: 11, color: 'var(--ink-secondary)', margin: '0 0 8px' }}>
              Prototype demo accounts (seeded, not real user provisioning — see High-Level Design doc):
            </p>
            {demoAccounts.map((a) => (
              <p key={a.username} className="mono" style={{ fontSize: 11, color: 'var(--ink-secondary)', margin: '2px 0' }}>
                {a.username} / {a.username}123 <span style={{ opacity: 0.7 }}>({a.role})</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
