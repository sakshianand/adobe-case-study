const Groq = require('groq-sdk');
const { queryJobs } = require('../../../data/jobStore');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Very small, deliberately literal extraction — pulls a quality-score
// threshold and comparison direction out of the question if present.
// This is NOT an LLM call: same "router doesn't need fuzzy reasoning"
// principle applied to filter extraction too. A production version with
// more query shapes might graduate this to an LLM function-call, but for
// the shapes in the brief, regex is honest and traceable.
function extractFilters(question) {
  const filters = {};
  const belowMatch = question.match(/below\s+(\d+)%?/i) || question.match(/under\s+(\d+)%?/i);
  const aboveMatch = question.match(/above\s+(\d+)%?/i) || question.match(/over\s+(\d+)%?/i);
  if (belowMatch) filters.qualityScoreBelow = Number(belowMatch[1]);
  if (aboveMatch) filters.qualityScoreAbove = Number(aboveMatch[1]);

  const platforms = ['Google', 'Meta', 'Amazon', 'Adobe'];
  const foundPlatform = platforms.find((p) => new RegExp(p, 'i').test(question));
  if (foundPlatform) filters.platform = foundPlatform;

  // Relative date phrases -> an absolute sinceDate. Covers the brief's own
  // "last week" example plus the common adjacent phrasings; anything more
  // exotic ("two Tuesdays ago") isn't worth the complexity here.
  const now = new Date();
  if (/yesterday/i.test(question)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    filters.sinceDate = d.toISOString();
  } else if (/last week/i.test(question)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    filters.sinceDate = d.toISOString();
  } else {
    const lastNDays = question.match(/last\s+(\d+)\s+days?/i);
    if (lastNDays) {
      const d = new Date(now);
      d.setDate(d.getDate() - Number(lastNDays[1]));
      filters.sinceDate = d.toISOString();
    }
  }

  return filters;
}

// Computes the EXACT answer from job history first, then uses the LLM
// only to phrase it — same boundary as the AI Quality Summary. The model
// is given the real numbers and file names and instructed not to invent
// beyond them; it never sees raw unfiltered job data to count itself.
async function handleStructuredQuery(question, conversationHistory) {
  const filters = extractFilters(question);
  const matches = queryJobs(filters);

  const factsForModel = matches.map((j) => ({
    fileName: j.fileName,
    jobId: j.jobId,
    qualityScore: j.validationSummary?.qualityScore ?? null,
    platform: j.platform,
    correctionCount: j.validationSummary?.businessRuleCorrections?.length ?? 0,
    createdAt: j.createdAt,
  }));

  const systemPrompt = `You answer questions about a marketing data ingestion system using ONLY the JSON facts provided below. Never invent a number, file name, or count not present in the facts. Every file you mention, cite its exact file name. If the facts list is empty, say plainly that no matching runs were found — do not guess.

Facts (exact, computed, not to be recalculated):
${JSON.stringify(factsForModel, null, 2)}`;

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: question },
    ],
  });

  return {
    answer: completion.choices[0].message.content,
    sources: factsForModel.map((f) => ({ fileName: f.fileName, jobId: f.jobId })),
    path: 'structured',
  };
}

module.exports = { handleStructuredQuery, extractFilters };