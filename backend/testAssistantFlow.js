// Structural test — mocks embed, Chroma, and Groq since none are reachable
// from this sandbox. Proves the routing, multi-turn history, and both
// handlers' data flow are wired correctly; real answer quality needs
// verification on your machine with real Groq/Chroma/HF access.

const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id.endsWith('embedClient')) {
    return { embed: async () => new Array(384).fill(0.1) };
  }
  if (id === 'chromadb') {
    const fakeDocs = [
      '[Source: meta_spend_july.csv, job job-1] File "meta_spend_july.csv" (job job-1), platform Meta, ingested 2026-07-28. Status: failed. Failed with error: Missing required columns: Region',
    ];
    const fakeMeta = [{ fileName: 'meta_spend_july.csv', jobId: 'job-1' }];
    return {
      ChromaClient: class {
        getOrCreateCollection() {
          return {
            upsert: async () => {},
            query: async () => ({ documents: [fakeDocs], metadatas: [fakeMeta] }),
          };
        }
      },
    };
  }
  if (id === 'groq-sdk') {
    return class Groq {
      constructor() {
        this.chat = {
          completions: {
            create: async ({ messages }) => {
              const lastUserMsg = messages[messages.length - 1].content;
              return {
                choices: [{ message: { content: `[mocked answer for: "${lastUserMsg}"]` } }],
              };
            },
          },
        };
      }
    };
  }
  return originalRequire.apply(this, arguments);
};

process.env.GROQ_API_KEY = 'dummy';

const { classifyQuery } = require('./services/ai/rag/queryRouter');
const { handleSemanticQuery } = require('./services/ai/rag/semanticHandler');
const { handleStructuredQuery } = require('./services/ai/rag/structuredHandler');
const { createJob, updateJob } = require('./data/jobStore');
const { getHistory, appendTurn } = require('./data/conversationStore');

(async () => {
  // Seed some fake job history for the structured path to query against
  const jobId1 = createJob();
  updateJob(jobId1, {
    status: 'complete',
    fileName: 'google_ads_july.csv',
    platform: 'Google',
    createdAt: new Date().toISOString(),
    validationSummary: { qualityScore: 65, businessRuleCorrections: [1, 2, 3] },
  });
  const jobId2 = createJob();
  updateJob(jobId2, {
    status: 'complete',
    fileName: 'meta_spend_july.csv',
    platform: 'Meta',
    createdAt: new Date().toISOString(),
    validationSummary: { qualityScore: 92, businessRuleCorrections: [] },
  });

  console.log('--- Router test ---');
  console.log('"Why did yesterday\'s Meta upload fail?" ->', classifyQuery("Why did yesterday's Meta upload fail?"));
  console.log('"Show me all files below 80%" ->', classifyQuery('Show me all files below 80%'));

  console.log('\n--- Structured handler ---');
  const structuredResult = await handleStructuredQuery('Show me all files with a quality score below 80%', []);
  console.log(JSON.stringify(structuredResult, null, 2));

  console.log('\n--- Semantic handler ---');
  const semanticResult = await handleSemanticQuery("Why did yesterday's Meta upload fail?", []);
  console.log(JSON.stringify(semanticResult, null, 2));

  console.log('\n--- Multi-turn conversation store ---');
  const sessionId = 'test-session';
  appendTurn(sessionId, 'user', 'Show me all files below 80%');
  appendTurn(sessionId, 'assistant', structuredResult.answer);
  appendTurn(sessionId, 'user', 'Which of those were from Google?');
  console.log(getHistory(sessionId));
})();