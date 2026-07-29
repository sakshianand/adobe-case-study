// Categorical normalization is a lookup-table problem, not an AI problem —
// explicit mapping is more reliable and cheaper than a model call, and it's
// trivially easy to extend (this table doubles as a natural starting point
// for a future "self-service validation rule config" UI).
//
// This runs BEFORE the enum check in the pipeline. A raw value like
// "GoogleAds" is invalid against the schema's enum, but it has a known
// correction — rejecting it before normalization would throw away a
// fixable row instead of fixing it.

const PLATFORM_MAP = {
  GoogleAds: 'Google',
  Google_Ads: 'Google',
  'google ads': 'Google',
  FB: 'Meta',
  Facebook: 'Meta',
  facebook: 'Meta',
  IG: 'Meta',
  Instagram: 'Meta',
  AmazonDSP: 'Amazon',
  'Amazon DSP': 'Amazon',
};

const REGION_MAP = {
  'North America': 'NA',
  'N.A.': 'NA',
  'n/a': 'NA',
  'Northern America': 'NA',
  'Europe, Middle East, Africa': 'EMEA',
  'Latin America': 'LATAM',
  'Asia Pacific': 'APAC',
};

function normalizeField(value, map) {
  const corrected = map[value];
  if (corrected && corrected !== value) {
    return { corrected: true, original: value, correctedValue: corrected };
  }
  return { corrected: false, correctedValue: value };
}

// Applies both mappings and returns the row with Platform/Region normalized,
// plus a list of the individual corrections made (for the AI Quality Summary
// and the Review UI to show "3 platform values auto-corrected", etc.).
function applyBusinessRules(row) {
  const corrections = [];

  const platformResult = normalizeField(row.Platform, PLATFORM_MAP);
  if (platformResult.corrected) {
    corrections.push({ field: 'Platform', original: platformResult.original, correctedValue: platformResult.correctedValue });
  }

  const regionResult = normalizeField(row.Region, REGION_MAP);
  if (regionResult.corrected) {
    corrections.push({ field: 'Region', original: regionResult.original, correctedValue: regionResult.correctedValue });
  }

  const normalizedRow = {
    ...row,
    Platform: platformResult.correctedValue,
    Region: regionResult.correctedValue,
  };

  return { normalizedRow, corrections };
}

module.exports = { applyBusinessRules, PLATFORM_MAP, REGION_MAP };