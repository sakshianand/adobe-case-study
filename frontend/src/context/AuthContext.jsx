import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { login as apiLogin, logout as apiLogout, getCurrentUser } from '../api/client';

// Holds only { username, role } — never a token. The session itself lives
// in an httpOnly cookie the browser manages automatically; this context
// exists purely so the UI knows who's logged in and can hide actions a
// role can't use. It is NOT the security boundary — every gated route is
// re-checked server-side (middleware/auth.js) regardless of what this
// context says, since a user could always edit React state or call the
// API directly.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username, password) => {
    const loggedInUser = await apiLogin(username, password);
    setUser(loggedInUser);
    return loggedInUser;
  }, []);

  const logout = useCallback(async () => {
    await apiLogout().catch(() => {}); // best-effort — clear local state either way
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
