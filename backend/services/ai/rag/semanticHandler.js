const Groq = require('groq-sdk');
const { embed } = require('../embeddings/embedClient');
const { getCollection } = require('./indexer');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const TOP_K = 5;

// Vector-retrieval counterpart to handleStructuredQuery — same boundary:
// Chroma does retrieval only, the LLM only phrases what was retrieved.
// It's told explicitly not to invent beyond the retrieved summaries, same
// as the structured path is told not to invent beyond the exact facts.
async function handleSemanticQuery(question, conversationHistory) {
  const collection = await getCollection();
  const queryEmbedding = await embed(question);

  const results = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults: TOP_K,
  });

  const documents = results.documents?.[0] || [];
  const metadatas = results.metadatas?.[0] || [];

  const systemPrompt = `You answer questions about a marketing data ingestion system using ONLY the run summaries retrieved below. Never invent a number, file name, or detail not present in them. Every file you mention, cite its exact file name. If no run summaries were retrieved, say plainly that no matching runs were found — do not guess.

Retrieved run summaries (most relevant first):
${documents.map((d, i) => `${i + 1}. ${d}`).join('\n') || '(none retrieved)'}`;

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
    sources: metadatas.map((m) => ({ fileName: m.fileName, jobId: m.jobId })),
    path: 'semantic',
  };
}

module.exports = { handleSemanticQuery };
