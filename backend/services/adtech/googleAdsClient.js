// Stubbed Google Ads API client — no real network call. The brief asks to
// "simulate or stub an Ad Tech API (Google Ads, Meta, or Amazon DSP — pick
// one)"; Google Ads was picked because it's the platform already present
// in both the schema's VALID_PLATFORMS and the sample data.
//
// Keyed on the same MASTER_CAMPAIGNS names used for campaign-name matching
// (masterCampaignList.js) so the reconciliation join has a stable key to
// compare against on both sides. Deliberately spans the full range of
// outcomes reconciliation can produce, not just the brief's two examples:
//   - "Summer Sale 2025"      — exact match (0% variance)
//   - "Back To School"        — exact match (0% variance)
//   - "Q3 Brand Awareness"    — variance just UNDER a 5% threshold (match)
//   - "Holiday Launch"        — the brief's own >5% example (~11%, review)
//   - "Winter Clearance"      — a large variance well past threshold (review)
//   - "New Year Promo"        — platform reports spend the upload never
//                               mentions (unmatched_platform)
// "Prime Day Push" is deliberately absent — see sample_reconciliation.csv,
// which uploads spend for it — so there's also an unmatched_upload case.
const CANNED_PLATFORM_SPEND = {
  'Summer Sale 2025': 12350,
  'Back To School': 5000,
  'Q3 Brand Awareness': 4000,
  'Holiday Launch': 9100,
  'Winter Clearance': 3200,
  'New Year Promo': 2500,
};

// Real Ad Tech APIs (Google Ads, Meta Marketing API, Amazon DSP) require a
// campaign identifier and an explicit date range per call, and return
// paginated, per-day rows. This stub collapses that down to a single
// totals-per-campaign lookup — the shape reconciliation actually needs —
// and documents the gap rather than pretending to page/filter by date.
async function fetchReportedSpend({ campaignNames = [], dateRange } = {}) {
  const known = Object.keys(CANNED_PLATFORM_SPEND);
  const requested = campaignNames.length > 0 ? campaignNames : known;

  const results = {};
  for (const name of requested) {
    if (Object.prototype.hasOwnProperty.call(CANNED_PLATFORM_SPEND, name)) {
      results[name] = CANNED_PLATFORM_SPEND[name];
    }
  }
  // Platform-only campaigns (spend the platform reports that wasn't in the
  // requested set at all) still surface, so an unmatched-on-upload-side
  // discrepancy is visible even if the caller didn't ask about it by name.
  for (const name of known) {
    if (!(name in results)) results[name] = CANNED_PLATFORM_SPEND[name];
  }

  return { platform: 'Google Ads', dateRange: dateRange || null, spendByCampaign: results };
}

module.exports = { fetchReportedSpend, CANNED_PLATFORM_SPEND };
