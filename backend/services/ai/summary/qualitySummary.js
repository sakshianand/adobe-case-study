const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Same boundary as the RAG handlers: every number here is pulled straight
// from validationSummary/matches, computed deterministically elsewhere
// (validationPipeline.js, matchAllCampaigns.js). The AI call below only
// turns these facts into a sentence — it never counts or invents one.
//
// Campaign-name matches are deliberately NOT described as "corrected" —
// campaignMatcher.js never auto-applies a match, only ever suggests or
// flags one for a human to approve. Calling that "auto-corrected" would
// misstate what actually happened to the row.
function buildSummaryFacts({ validationSummary: s, matches = [] }) {
  const correctionsByField = {};
  for (const c of s.businessRuleCorrections) {
    correctionsByField[c.field] = (correctionsByField[c.field] || 0) + 1;
  }

  const unrecognizedByField = {};
  for (const issue of s.schemaIssues) {
    if (issue.stage === 'enum') {
      for (const e of issue.enumErrors || []) {
        unrecognizedByField[e.field] = (unrecognizedByField[e.field] || 0) + 1;
      }
    }
  }

  return {
    qualityScore: s.qualityScore,
    totalRows: s.totalRows,
    rejectedRows: s.rejected,
    fieldCorrections: correctionsByField, // e.g. { Platform: 3, Region: 2 } — auto-corrected AND flagged for review
    unrecognizedValues: unrecognizedByField, // e.g. { Platform: 2 } — rejected, no known mapping
    dateFlagCount: s.dateFlags.length,
    duplicateCount: s.duplicates.campaignIds.length + s.duplicates.rowHashes.length,
    suggestedCampaignMatches: matches.filter((m) => m.action === 'suggest').length,
    flaggedCampaignMatches: matches.filter((m) => m.action === 'flag_for_review').length,
  };
}

async function generateQualitySummary(job) {
  const facts = buildSummaryFacts(job);

  const systemPrompt = `You write a short, human-readable quality summary of one marketing data ingestion run, using ONLY the JSON facts below. Never invent a number, field name, or count not present in them.

Match this tone and structure — short plain sentences, no bullet points, no preamble, no markdown:
"3 Platform values auto-corrected. 2 Region values flagged for review. 15 duplicates detected. Platform field shows 2 unrecognised values. File quality score: 88%."

Only mention a category if its count is greater than zero — omit anything at zero rather than saying "0 of something." Campaign name matches are suggestions for a human to approve, never call them "auto-corrected." Always end with the exact quality score, unchanged.

Facts:
${JSON.stringify(facts, null, 2)}`;

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'system', content: systemPrompt }],
  });

  return completion.choices[0].message.content.trim();
}

module.exports = { generateQualitySummary, buildSummaryFacts };
