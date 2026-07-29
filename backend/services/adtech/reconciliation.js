const { fetchReportedSpend } = require('./googleAdsClient');

const DEFAULT_VARIANCE_THRESHOLD = 0.05; // 5%, per the brief's own example

// Rows needing review already carry a name suggested by the AI matcher
// (campaignMatcher.js) — reconciliation should compare against that
// canonical name, not the raw upload spelling, otherwise "Summer Sale"
// (raw) would never line up with "Summer Sale 2025" (platform-reported).
// A flagged-for-review match (no confident suggestion) has no canonical
// name yet, so it falls back to the raw uploaded name as-is.
function canonicalCampaignName(row, matchByRow) {
  const match = matchByRow.get(row);
  if (match && match.action === 'suggest' && match.matchedName) {
    return match.matchedName;
  }
  return null;
}

// Sums uploaded Spend per canonical campaign name. processedCampaigns only
// carries rows that survived validation (see validationPipeline.js) —
// rejected rows never reach reconciliation, matching the pipeline's own
// "rejected rows are excluded entirely" rule.
function aggregateUploadedSpend(processedCampaigns, matches) {
  const matchByRow = new Map(matches.map((m) => [m.row, m]));
  const totals = new Map();

  for (const campaign of processedCampaigns) {
    const name = canonicalCampaignName(campaign.row, matchByRow) || campaign.campaignName;
    const spend = Number(campaign.spend) || 0;
    totals.set(name, (totals.get(name) || 0) + spend);
  }

  return totals;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Variance is measured against the UPLOADED figure, not the platform's —
// matches the brief's own worked example (Holiday Launch: $8,200 uploaded
// vs. $9,100 reported -> "11%"; $900/$9,100 = 9.9%, but $900/$8,200 =
// 11.0%). Reads as "how far off was the file we were given," which is
// also the more useful framing for the person reconciling: the platform
// number can't be edited, but the uploaded number is exactly the thing
// they'd go fix.
function computeVariance(uploaded, reported) {
  if (uploaded === 0) return reported === 0 ? 0 : 1;
  return Math.abs(uploaded - reported) / uploaded;
}

// Builds the brief's exact table shape: Campaign / Uploaded Spend /
// Platform Reported / Variance / Status, plus unmatched rows on either
// side (uploaded a campaign the platform never reported spend for, or
// vice versa).
async function reconcileSpend(job, { threshold = DEFAULT_VARIANCE_THRESHOLD } = {}) {
  const validationSummary = job.validationSummary;
  const matches = job.matches || [];

  if (!validationSummary || !validationSummary.processedCampaigns) {
    throw new Error('Job has no processed campaign data to reconcile yet.');
  }

  const uploadedByCampaign = aggregateUploadedSpend(validationSummary.processedCampaigns, matches);
  const { platform, spendByCampaign: platformByCampaign } = await fetchReportedSpend({
    campaignNames: Array.from(uploadedByCampaign.keys()),
  });

  const allNames = new Set([...uploadedByCampaign.keys(), ...Object.keys(platformByCampaign)]);
  const rows = [];

  for (const name of allNames) {
    const hasUploaded = uploadedByCampaign.has(name);
    const hasPlatform = Object.prototype.hasOwnProperty.call(platformByCampaign, name);
    const uploadedSpend = hasUploaded ? uploadedByCampaign.get(name) : null;
    const reportedSpend = hasPlatform ? platformByCampaign[name] : null;

    if (hasUploaded && hasPlatform) {
      const variance = computeVariance(uploadedSpend, reportedSpend);
      rows.push({
        campaign: name,
        uploadedSpend: round2(uploadedSpend),
        reportedSpend: round2(reportedSpend),
        variance: round2(variance * 100), // as a percentage, matching the brief's "0.4%" style
        status: variance > threshold ? 'review' : 'match',
      });
    } else if (hasUploaded) {
      rows.push({
        campaign: name,
        uploadedSpend: round2(uploadedSpend),
        reportedSpend: null,
        variance: null,
        status: 'unmatched_upload', // uploaded, but the ad platform reports no spend for it
      });
    } else {
      rows.push({
        campaign: name,
        uploadedSpend: null,
        reportedSpend: round2(reportedSpend),
        variance: null,
        status: 'unmatched_platform', // platform reports spend the upload never mentioned
      });
    }
  }

  rows.sort((a, b) => a.campaign.localeCompare(b.campaign));

  const summary = {
    matched: rows.filter((r) => r.status === 'match').length,
    review: rows.filter((r) => r.status === 'review').length,
    unmatchedUpload: rows.filter((r) => r.status === 'unmatched_upload').length,
    unmatchedPlatform: rows.filter((r) => r.status === 'unmatched_platform').length,
  };

  return { platform, threshold, rows, summary };
}

module.exports = { reconcileSpend, aggregateUploadedSpend, computeVariance, DEFAULT_VARIANCE_THRESHOLD };
