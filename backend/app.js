const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const authRoute = require('./routes/auth');
const uploadRoute = require('./routes/upload');
const validationRoute = require('./routes/validation');
const assistantRoute = require('./routes/assistant');
const reconciliationRoute = require('./routes/reconciliation');
const approveRoute = require('./routes/approve');
const pipelineStatusRoute = require('./routes/pipelineStatus');
const databricksRoute = require('./routes/databricks');
const schedulesRoute = require('./routes/schedules');
const dashboardRoute = require('./routes/dashboard');
const auditRoute = require('./routes/audit');
const { requireAuth } = require('./middleware/auth');
const { startAll } = require('./services/scheduler/schedulerEngine');
const { listSchedules } = require('./data/scheduleStore');

const app = express();

// credentials: true + an explicit origin (not '*') is required for the
// session cookie to be sent/set cross-origin — the frontend dev server
// (5173) and this API (3000) are different origins even though both are
// localhost. FRONTEND_ORIGIN is configurable via env for whatever port/
// host actually serves the SPA in a given environment.
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json()); // needed for /assistant/query's, /approve's JSON bodies — upload/validation don't need this, multer handles their bodies
app.use(cookieParser());

app.use('/', authRoute); // /auth/login must be reachable while logged out — mounted before the auth gate below

app.use(requireAuth); // everything mounted below this line requires a valid session

// Read-only / any-authenticated-role surfaces — no extra role check
// beyond "is this session valid," which requireAuth above already did.
app.use('/', validationRoute);
app.use('/', assistantRoute);
app.use('/', reconciliationRoute);
app.use('/', pipelineStatusRoute);
app.use('/', dashboardRoute);

// Role-gated surfaces. The role check itself lives INSIDE each of these
// route files (as `router.use(requireRole(...))`, or per-route for
// databricks.js's mixed-role endpoints) rather than here at the mount
// call — `app.use('/', middleware, router)` would run `middleware` for
// every request reaching this line regardless of whether it actually
// matches a route inside `router`, since '/' matches everything as a
// prefix. Scoping the gate inside the router avoids that trap.
app.use('/', uploadRoute);
app.use('/', approveRoute);
app.use('/', databricksRoute);
app.use('/', schedulesRoute);
app.use('/', auditRoute);

// Centralized error handler — catches anything a route didn't handle
// itself, so a bug doesn't come back to the client as a raw stack trace.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong processing that request.' });
});

startAll(listSchedules()); // re-registers cron tasks for any schedules already in the (in-memory) store at boot

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend listening on port ${PORT}`));
