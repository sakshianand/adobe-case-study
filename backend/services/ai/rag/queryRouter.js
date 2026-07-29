// Classifies a question into 'structured' (needs exact counts/filters over
// job history) or 'semantic' (needs explanation/narrative, served by
// vector retrieval). Deliberately regex-based, not an LLM call — routing
// a handful of known question shapes doesn't need fuzzy reasoning, and a
// wrong route here is cheap to get right with plain pattern matching.
// Same "AI only where it adds value" boundary applied one more layer up.
const STRUCTURED_PATTERNS = [
  /how many/i,
  /count of/i,
  /\bbelow\s+\d+%?/i,
  /\babove\s+\d+%?/i,
  /\bunder\s+\d+%?/i,
  /\bover\s+\d+%?/i,
  /show me all/i,
  /list all/i,
  /list of/i,
];

function classifyQuery(question) {
  return STRUCTURED_PATTERNS.some((pattern) => pattern.test(question)) ? 'structured' : 'semantic';
}

module.exports = { classifyQuery };