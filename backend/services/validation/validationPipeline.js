const fs = require('fs');
const { parse } = require('csv-parse');

const { validateHeaders, validateStructure, validateEnums } = require('./schemaValidator');
const { standardizeDate } = require('./dateStandardizer');
const { applyBusinessRules } = require('./businessRules');

function makeSummary() {
  return {
    totalRows: 0,
    rejected: 0, // structurally unusable OR still-invalid after normalization — excluded entirely
    processed: 0, // usable — made it through all schema checks, may still need review
    needsReview: 0, // subset of processed: has a date flag, correction, or duplicate
    cleanRows: 0, // subset of processed: zero flags of any kind
    schemaIssues: [],
    dateFlags: [],
    missingData: [],
    businessRuleCorrections: [],
    duplicates: { campaignIds: [], rowHashes: [] },
    qualityScore: null,
    // Only { row, campaignName, spend } per processed row — not the full
    // row — so this stays cheap even at scale. This is what campaign
    // matching runs against in a second pass, and what spend
    // reconciliation (services/adtech/reconciliation.js) aggregates from,
    // after validation completes.
    processedCampaigns: [],
    // Tally of normalized Platform values across processed rows — used to
    // derive a file's "dominant platform" for RAG citation metadata (e.g.
    // answering "yesterday's Meta upload"). Derived from real row data,
    // never guessed at upload time.
    platformCounts: {},
  };
}

// The one piece of state that grows with row count. Fine up to a few
// million rows; at real scale (tens of millions) this would move to a
// bloom filter or an external store (e.g. Redis SET) instead of an
// in-process Set, since memory here is O(unique campaign IDs).
function makeDedupeState() {
  return {
    seenCampaignIds: new Set(),
    seenRowHashes: new Set(),
  };
}

function rowHash(row) {
  return `${row['Campaign ID']}|${row.Date}|${row.Spend}`;
}

// Order matters here, and each step's position is a deliberate decision:
//   1. Structural check FIRST — missing fields / bad types can't be fixed
//      by normalization, so there's no point running anything else.
//   2. Business-rule normalization SECOND — corrects known-bad categorical
//      values (GoogleAds -> Google) before we judge whether they're legal.
//   3. Enum check on the NORMALIZED row — only rejects values that are
//      still invalid after correction, i.e. genuinely unrecognized.
//   4. Date + duplicates — independent of the above, always run if the
//      row survived steps 1-3.
function validateRow(row, rowNumber, summary, dedupeState) {
  const structureResult = validateStructure(row);
  if (!structureResult.valid) {
    summary.rejected++;
    summary.schemaIssues.push({ row: rowNumber, stage: 'structure', ...structureResult });
    return;
  }

  const { normalizedRow, corrections } = applyBusinessRules(row);

  const enumResult = validateEnums(normalizedRow);
  if (!enumResult.valid) {
    summary.rejected++;
    summary.schemaIssues.push({ row: rowNumber, stage: 'enum', ...enumResult });
    return; // still invalid after normalization — genuinely unrecognized value
  }

  let hasIssue = false; // tracks whether THIS row needs a human glance

  if (corrections.length > 0) {
    corrections.forEach((c) => summary.businessRuleCorrections.push({ row: rowNumber, ...c }));
    hasIssue = true;
  }

  const dateResult = standardizeDate(normalizedRow.Date);
  if (dateResult.flagged) {
    summary.dateFlags.push({ row: rowNumber, raw: normalizedRow.Date, reason: dateResult.reason });
    hasIssue = true;
  }

  const campaignId = normalizedRow['Campaign ID'];
  if (dedupeState.seenCampaignIds.has(campaignId)) {
    summary.duplicates.campaignIds.push({ row: rowNumber, campaignId });
    hasIssue = true;
  } else {
    dedupeState.seenCampaignIds.add(campaignId);
  }

  const hash = rowHash(normalizedRow);
  if (dedupeState.seenRowHashes.has(hash)) {
    summary.duplicates.rowHashes.push({ row: rowNumber, hash });
    hasIssue = true;
  } else {
    dedupeState.seenRowHashes.add(hash);
  }

  summary.processed++;
  if (hasIssue) {
    summary.needsReview++;
  } else {
    summary.cleanRows++;
  }

  summary.processedCampaigns.push({
    row: rowNumber,
    campaignName: normalizedRow['Campaign Name'],
    spend: Number(normalizedRow.Spend),
    // Carried alongside spend for the Ad Platform push (services/adtech/adPlatformPush.js),
    // which sends back Campaign + Spend + Impressions as "campaign performance data" —
    // spend alone (what reconciliation needs) isn't the full performance picture.
    impressions: Number(normalizedRow.Impressions),
  });
  summary.platformCounts[normalizedRow.Platform] = (summary.platformCounts[normalizedRow.Platform] || 0) + 1;
}

function computeQualityScore(summary) {
  const total = summary.totalRows || 1;
  const schemaCleanRate = (total - summary.schemaIssues.length) / total;
  const dateFlagRate = 1 - summary.dateFlags.length / total;
  const duplicateRate =
    1 - (summary.duplicates.campaignIds.length + summary.duplicates.rowHashes.length) / total;
  const businessRuleCleanRate = 1 - summary.businessRuleCorrections.length / total;

  // Weighted, deterministic — this is the formula the AI quality summary
  // narrates in prose later; the AI never computes or invents this number.
  const score =
    schemaCleanRate * 0.3 + dateFlagRate * 0.2 + duplicateRate * 0.3 + businessRuleCleanRate * 0.2;

  return Math.round(score * 100);
}

function validateFileStreaming(filePath) {
  return new Promise((resolve, reject) => {
    const summary = makeSummary();
    const dedupeState = makeDedupeState();
    let rowNumber = 0;
    let headersChecked = false;

    // Streaming parser keeps memory use bounded by processing one row at a time.
    // For production scale, this is still the right pattern, but the source file
    // should ideally come from object storage and be processed by distributed workers
    // rather than a single local server process.
    const parser = fs.createReadStream(filePath).pipe(parse({ columns: true, skip_empty_lines: true }));

    parser.on('readable', function () {
      let row;
      while ((row = parser.read()) !== null) {
        if (!headersChecked) {
          const headerResult = validateHeaders(Object.keys(row));
          if (!headerResult.valid) {
            parser.destroy();
            reject(new Error(`Missing required columns: ${headerResult.missingColumns.join(', ')}`));
            return;
          }
          headersChecked = true;
        }

        rowNumber++;
        summary.totalRows++;
        validateRow(row, rowNumber, summary, dedupeState);
      }
    });

    parser.on('error', reject);
    parser.on('end', () => {
      summary.qualityScore = computeQualityScore(summary);
      resolve(summary);
    });
  });
}

module.exports = { validateFileStreaming, computeQualityScore };