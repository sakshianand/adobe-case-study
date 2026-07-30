const express = require('express');
const { listAudit } = require('../data/auditStore');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Admin-only — the NFR asks for "an audit log for all data mutations and
// approvals," which needs to be more than internal plumbing to actually
// satisfy; this is what lets it be inspected. requireRole is applied
// directly on the route, not via router.use() — see upload.js's comment
// for why a router-level, no-path .use() leaks into other routers
// mounted at the same app.js '/' base.
router.get('/audit', requireRole('admin'), (req, res) => {
  res.status(200).json({ entries: listAudit() });
});

module.exports = router;
