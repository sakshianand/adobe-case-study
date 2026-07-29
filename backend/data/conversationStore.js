// Session-scoped multi-turn history. In-memory Map, same trade-off as
// jobStore — fine for a prototype, would be Redis or Postgres in
// production so history survives a restart and works across instances.
const conversations = new Map();
const MAX_TURNS = 6; // last 6 messages (3 exchanges) kept, to bound prompt size

function getHistory(sessionId) {
  return conversations.get(sessionId) || [];
}

function appendTurn(sessionId, role, content) {
  const history = getHistory(sessionId);
  const updated = [...history, { role, content }].slice(-MAX_TURNS);
  conversations.set(sessionId, updated);
}

module.exports = { getHistory, appendTurn };