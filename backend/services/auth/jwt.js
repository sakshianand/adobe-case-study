const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const TOKEN_TTL = '8h';
const COOKIE_NAME = 'session';

// Never falls back to a fixed, known secret — that would be a hardcoded
// credential with extra steps. If JWT_SECRET isn't set (e.g. a fresh
// clone before .env is configured), a random secret is generated for
// this process only. The failure mode is safe: every session is
// invalidated on restart, not "silently signs tokens with a secret
// anyone reading this file also knows." Production MUST set JWT_SECRET
// explicitly (see .env.example) so sessions survive a restart/deploy.
const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

if (!process.env.JWT_SECRET) {
  console.warn(
    '[auth] JWT_SECRET is not set — using a random per-process secret. ' +
    'All sessions will be invalidated on restart. Set JWT_SECRET in .env for anything beyond local dev.'
  );
}

function signSession(user) {
  return jwt.sign({ username: user.username, role: user.role }, SECRET, { expiresIn: TOKEN_TTL });
}

function verifySession(token) {
  try {
    return jwt.verify(token, SECRET); // { username, role, iat, exp }
  } catch {
    return null;
  }
}

module.exports = { signSession, verifySession, COOKIE_NAME };
