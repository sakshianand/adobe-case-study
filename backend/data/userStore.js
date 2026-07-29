const bcrypt = require('bcryptjs');

// Seeded demo accounts, one per role — standing in for a real user
// directory (an admin console, an SSO/IdP integration) that a
// time-boxed prototype doesn't have room to build. Passwords are still
// bcrypt-hashed at boot rather than compared in plaintext, so the
// "seeded, not real provisioning" shortcut doesn't also mean "plaintext
// password storage" — that part follows real practice regardless of
// where the accounts came from.
//
// In-memory like every other store here (jobStore.js etc.) — same
// tradeoff, same production fix: a real users table (Postgres), not a
// Map, so accounts survive a restart and can be managed without a
// redeploy.
const DEMO_ACCOUNTS = [
  { username: 'admin', password: 'admin123', role: 'admin' },
  { username: 'approver', password: 'approver123', role: 'approver' },
  { username: 'uploader', password: 'uploader123', role: 'uploader' },
];

const ROLES = ['uploader', 'approver', 'admin'];

const users = new Map(); // username -> { username, passwordHash, role }

const SALT_ROUNDS = 10;

function seed() {
  for (const account of DEMO_ACCOUNTS) {
    users.set(account.username, {
      username: account.username,
      passwordHash: bcrypt.hashSync(account.password, SALT_ROUNDS),
      role: account.role,
    });
  }
}

seed();

function findUser(username) {
  return users.get(username) || null;
}

async function verifyPassword(username, password) {
  const user = findUser(username);
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.passwordHash);
  return valid ? user : null;
}

module.exports = { findUser, verifyPassword, ROLES, DEMO_ACCOUNTS: DEMO_ACCOUNTS.map((a) => ({ username: a.username, role: a.role })) };
