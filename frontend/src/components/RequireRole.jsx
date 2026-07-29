import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Blocks direct navigation to a role-gated URL (typing /scheduling in the
// address bar, not just clicking a hidden nav link) — Layout already hides
// the link, this stops the route itself from rendering. Still UX only:
// the backend's requireRole middleware is what actually protects the data.
export default function RequireRole({ roles }) {
  const { user } = useAuth();
  if (!roles.includes(user?.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}
