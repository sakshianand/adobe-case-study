const express = require('express');
const { listAudit } = require('../data/auditStore');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('admin')); // scoped to this router only — see upload.js's comment on why this can't live at the app.js mount call

// Admin-only (gated in app.js) — the NFR asks for "an audit log for all
// data mutations and approvals," which needs to be more than internal
// plumbing to actually satisfy; this is what lets it be inspected.
router.get('/audit', (req, res) => {
  res.status(200).json({ entries: listAudit() });
});

module.exports = router;
