const { embed, getEmbeddingVersionInfo } = require('../embeddings/embedClient');

// Lazily required to avoid a hard dependency on Chroma being reachable at
// module-load time — if Chroma isn't running, indexing should fail loudly
// per-job (caught in upload.js), not crash the whole server at startup.
let collectionPromise = null;
function getEmbeddingCollectionName() {
  return 'ingestion_runs_v1';
}

async function getCollection() {
  if (!collectionPromise) {
    const { ChromaClient } = require('chromadb');
    const client = new ChromaClient();
    collectionPromise = client.getOrCreateCollection({
      name: getEmbeddingCollectionName(),
      // We always compute and pass embeddings ourselves (via embedClient),
      // so Chroma never needs to embed anything server-side. Without this,
      // the client tries to resolve its DefaultEmbeddingFunction, which
      // requires the separate @chroma-core/default-embed package.
      embeddingFunction: {
        generate: async () => {
          throw new Error('ingestion_runs collection stores pre-computed embeddings only — generate() should never be called.');
        },
      },
    });
  }
  return collectionPromise;
}

// One natural-language document per completed job — this is what most
// semantic queries ("why did X fail") retrieve against. Deliberately a
// single summary doc per run rather than one chunk per row: row-level
// detail lives in Postgres/job history for the structured path, not here.
function buildRunSummaryText(job) {
  const s = job.validationSummary || {};
  const parts = [
    `File "${job.fileName}" (job ${job.jobId}), platform ${job.platform || 'unknown'}, ingested ${job.createdAt}.`,
    `Status: ${job.status}.`,
  ];

  if (job.status === 'failed') {
    parts.push(`Failed with error: ${job.error}`);
  } else if (s.totalRows !== undefined) {
    parts.push(
      `Quality score ${s.qualityScore}%. ${s.totalRows} total rows: ${s.processed} processed, ${s.rejected} rejected, ${s.needsReview} needed review, ${s.cleanRows} clean.`,
      `${s.businessRuleCorrections?.length || 0} business rule corrections applied.`,
      `${s.dateFlags?.length || 0} dates flagged as invalid.`,
      `${(s.duplicates?.campaignIds?.length || 0) + (s.duplicates?.rowHashes?.length || 0)} duplicates detected.`,
      `${(job.matches || []).filter((m) => m.action === 'suggest').length} campaign name matches suggested.`
    );
    if (s.schemaIssues?.length) {
      const reasons = s.schemaIssues.slice(0, 5).map((i) => `row ${i.row} (${i.stage})`).join(', ');
      parts.push(`Rejected rows: ${reasons}.`);
    }
  }

  return parts.join(' ');
}

async function indexJob(job) {
  const collection = await getCollection();
  const text = buildRunSummaryText(job);
  const vector = await embed(text);

  const embeddingVersionInfo = getEmbeddingVersionInfo();

  await collection.upsert({
    ids: [job.jobId],
    embeddings: [vector],
    documents: [text],
    metadatas: [{
      jobId: job.jobId,
      fileName: job.fileName || 'unknown',
      platform: job.platform || 'unknown',
      status: job.status,
      qualityScore: job.validationSummary?.qualityScore ?? null,
      createdAt: job.createdAt,
      ...embeddingVersionInfo,
    }],
  });
}

module.exports = { indexJob, buildRunSummaryText, getCollection, getEmbeddingCollectionName };