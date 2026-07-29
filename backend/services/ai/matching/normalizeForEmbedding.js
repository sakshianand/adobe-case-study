// Off-the-shelf sentence embeddings score concatenated/condensed names
// like "SummerSale25" lower than they should against "Summer Sale 2025",
// because the model was trained on natural sentences, not campaign-name
// shorthand. The fix is to make the INPUT more comparable before
// embedding — insert spaces at case and digit boundaries — not to layer
// extra string-similarity algorithms on top of the embedding score.
// Kept in its own file (not inside campaignMatcher.js or
// masterCampaignList.js) because both of those need it, and having
// each require the other to get it would create a circular dependency.
function normalizeForEmbedding(name) {
  return String(name || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase -> camel Case
    .replace(/([a-zA-Z])(\d)/g, '$1 $2') // Sale25 -> Sale 25
    .replace(/(\d)([a-zA-Z])/g, '$1 $2') // 25Sale -> 25 Sale
    .replace(/[_-]+/g, ' ')
    .trim();
}

module.exports = { normalizeForEmbedding };