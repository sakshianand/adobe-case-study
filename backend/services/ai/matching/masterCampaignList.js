const { embed } = require('../embeddings/embedClient');
const { normalizeForEmbedding } = require('./normalizeForEmbedding');

// Fixture — no master list was provided in the case study brief, only
// the concept and four example rows. This spans the regions/platforms
// in the schema and includes near-duplicates on purpose (e.g. the two
// "Back To School" variants) so matching has to actually discriminate,
// not just find the one obviously-right answer.
const MASTER_CAMPAIGNS = [
  'Summer Sale 2025',
  'Holiday Launch',
  'Back To School',
  'Back To School EMEA',
  'Winter Clearance',
  'New Year Promo',
  'Spring Refresh',
  'Black Friday Blowout',
  'Cyber Monday Deals',
  'Q3 Brand Awareness',
  'Prime Day Push',
  'End of Season Sale',
  'Product Launch — Adobe Firefly',
  'APAC Regional Kickoff',
  'LATAM Growth Push',
];

// Embed the whole list once, cache the vectors — never re-embed a static
// list on every incoming row. Normalized the same way as uploaded names,
// so both sides of the comparison go through identical preprocessing.
let cachedEmbeddings = null;

async function getMasterEmbeddings() {
  if (!cachedEmbeddings) {
    cachedEmbeddings = await Promise.all(
      MASTER_CAMPAIGNS.map(async (name) => ({
        name,
        vector: await embed(normalizeForEmbedding(name)),
      }))
    );
  }
  return cachedEmbeddings;
}

module.exports = { MASTER_CAMPAIGNS, getMasterEmbeddings };