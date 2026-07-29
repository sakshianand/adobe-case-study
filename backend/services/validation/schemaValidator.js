// Deterministic schema check — no AI here, per the brief's own rule:
// AI is for fuzzy reasoning (matching, RAG), not for checks that are
// cheaper and more reliable as plain rules.
//
// Split into two phases on purpose:
//   validateStructure — required fields present, types correct. Runs
//     FIRST, before business-rule normalization, because a structurally
//     broken row (missing field, non-numeric spend) can't be fixed by
//     normalization anyway.
//   validateEnums — Region/Platform are legal values. Runs AFTER business
//     rule normalization, because a raw value like "GoogleAds" is invalid
//     here but has a known correction — rejecting it before normalization
//     would discard a fixable row instead of fixing it.

const REQUIRED_COLUMNS = [
  'Campaign ID',
  'Campaign Name',
  'Platform',
  'Date',
  'Region',
  'Spend',
  'Impressions',
];

const VALID_REGIONS = ['APAC', 'EMEA', 'NA', 'LATAM'];
const VALID_PLATFORMS = ['Google', 'Meta', 'Amazon', 'Adobe'];

function validateHeaders(headerRow) {
  const missing = REQUIRED_COLUMNS.filter((col) => !headerRow.includes(col));
  return {
    valid: missing.length === 0,
    missingColumns: missing,
  };
}

function validateStructure(row) {
  const missingFields = REQUIRED_COLUMNS.filter(
    (col) => row[col] === undefined || row[col] === null || row[col].trim() === ''
  );

  if (missingFields.length > 0) {
    return { valid: false, missingFields, typeErrors: [] };
  }

  const typeErrors = [];
  if (Number.isNaN(Number(row.Spend))) {
    typeErrors.push('Spend is not a valid decimal');
  }
  if (!Number.isInteger(Number(row.Impressions))) {
    typeErrors.push('Impressions is not a valid integer');
  }

  return { valid: typeErrors.length === 0, missingFields: [], typeErrors };
}

// Called AFTER business-rule normalization — row.Platform and row.Region
// here are already-corrected values, not the raw upload.
function validateEnums(normalizedRow) {
  const enumErrors = [];
  if (!VALID_REGIONS.includes(normalizedRow.Region)) {
    enumErrors.push({ field: 'Region', value: normalizedRow.Region, allowed: VALID_REGIONS });
  }
  if (!VALID_PLATFORMS.includes(normalizedRow.Platform)) {
    enumErrors.push({ field: 'Platform', value: normalizedRow.Platform, allowed: VALID_PLATFORMS });
  }
  return { valid: enumErrors.length === 0, enumErrors };
}

module.exports = { validateHeaders, validateStructure, validateEnums, REQUIRED_COLUMNS, VALID_REGIONS, VALID_PLATFORMS };