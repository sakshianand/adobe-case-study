const { verifySession, COOKIE_NAME } = require('../services/auth/jwt');

// Verifies the session cookie and attaches req.user. Applied globally to
// every route mounted after it in app.js, except /auth itself (login has
// to be reachable while logged out). This is the one place "is this
// request authenticated at all" is decided — every route below only has
// to ask "is this role allowed," not "is this real."
function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  const session = token && verifySession(token);

  if (!session) {
    return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  }

  req.user = session;
  next();
}

// Role check only — assumes requireAuth already ran and set req.user.
// Kept as a separate middleware (rather than folded into requireAuth)
// so routes open to "any authenticated role" don't need a fake allow-all
// list; they just skip this middleware entirely.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `This action requires one of: ${roles.join(', ')}. Your role is "${req.user.role}".` });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
