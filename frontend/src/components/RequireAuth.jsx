import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Gates every route rendered through it: no session -> bounced to /login,
// remembering where they were headed so login can send them back. This is
// a UX convenience only — the real enforcement is server-side (every
// route requires a valid session cookie regardless of what the SPA's
// router does), so this component existing or not never changes what a
// determined attacker could reach by calling the API directly.
export default function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;

  return <Outlet />;
}
