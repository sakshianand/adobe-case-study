const crypto = require('crypto');

// Durable-for-the-process log of every RAG assistant query, separate from
// conversationStore.js — that store is session-scoped and capped at 6 turns
// specifically so prompts stay small, which makes it unusable as a history
// of "every question ever asked." This is the same in-memory tradeoff as
// jobStore.js otherwise: fine for a prototype, would be a real table in
// production.
const queries = []; // newest first
const MAX_LOG = 200;

// The answer text itself isn't stored — the dashboard only needs "what was
// asked, how was it routed, when," not full transcript replay, and storing
// full answers here would just duplicate conversationStore for no benefit.
function logQuery({ sessionId, message, route, sources }) {
  queries.unshift({
    id: crypto.randomUUID(),
    sessionId,
    message,
    route, // 'structured' | 'semantic'
    at: new Date().toISOString(),
    sourceCount: Array.isArray(sources) ? sources.length : 0,
  });
  queries.length = Math.min(queries.length, MAX_LOG);
}

function listQueries() {
  return queries;
}

module.exports = { logQuery, listQueries };
