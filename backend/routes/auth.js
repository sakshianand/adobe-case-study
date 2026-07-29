const express = require('express');
const { verifyPassword, DEMO_ACCOUNTS } = require('../data/userStore');
const { signSession, COOKIE_NAME } = require('../services/auth/jwt');
const { requireAuth } = require('../middleware/auth');
const { appendAudit } = require('../data/auditStore');

const router = express.Router();

const COOKIE_OPTIONS = {
  httpOnly: true, // never readable by frontend JS — the core XSS mitigation for session storage
  sameSite: 'lax', // localhost:5173 <-> localhost:3000 are same-site (SameSite ignores port); this also blocks the cookie on cross-site POSTs, covering CSRF for every mutating route without a separate token
  secure: process.env.NODE_ENV === 'production',
  maxAge: 8 * 60 * 60 * 1000, // 8h, matching the JWT's own expiry
};

router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required.' });
  }

  const user = await verifyPassword(username, password);
  if (!user) {
    // Deliberately the same error for "no such user" and "wrong password" —
    // distinguishing them lets an attacker enumerate valid usernames.
    appendAudit({ action: 'login_failed', actor: username });
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const token = signSession(user);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
  appendAudit({ action: 'login_succeeded', actor: user.username });
  res.status(200).json({ username: user.username, role: user.role });
});

router.post('/auth/logout', requireAuth, (req, res) => {
  res.clearCookie(COOKIE_NAME, COOKIE_OPTIONS);
  appendAudit({ action: 'logout', actor: req.user.username });
  res.status(204).send();
});

router.get('/auth/me', requireAuth, (req, res) => {
  res.status(200).json({ username: req.user.username, role: req.user.role });
});

// Not real user-management — just tells the login screen which demo
// accounts exist, so the prototype's "seeded, not provisioned" tradeoff
// is visible in the UI itself instead of buried in a source file only a
// developer would read.
router.get('/auth/demo-accounts', (req, res) => {
  res.status(200).json({ accounts: DEMO_ACCOUNTS });
});

module.exports = router;
