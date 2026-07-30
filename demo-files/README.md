# Demo files

Six CSVs, each isolating one part of the pipeline so the demo tells a clear story instead of one messy file. All verified against the actual pipeline with `node backend/runLocal.js <file>` — the numbers below are observed output, not predictions.

Upload via the app's **Select data source** page (`.csv` only — real `.xlsx`/`.xls` uploads are intentionally rejected with a "not implemented yet" message in this prototype; see [UploadPage.jsx](../frontend/src/pages/UploadPage.jsx:37)).

| # | File | Demonstrates | Result |
|---|---|---|---|
| 1 | `01_clean_baseline.csv` | Happy path — all valid, campaign names match the master list exactly | 8/8 processed, 0 flags, quality score **100** |
| 2 | `02_corrections_needed.csv` | Platform/Region auto-correction (`GoogleAds`→`Google`, `North America`→`NA`, etc.) — every row hits one of `businessRules.js`'s mapped values | 10/10 processed, all flagged for review (corrections applied), quality score **66** |
| 3 | `03_date_formats.csv` | All 4 recognized date formats plus the 2 flagged cases (unrecognized format, invalid month/day) | 6/6 processed, 2 flagged, quality score **93** |
| 4 | `04_invalid_rejected_rows.csv` | Rejections — one row per missing required field, bad Spend/Impressions type, and unrecoverable enum value (`TikTok`, `MARS`), plus 2 valid control rows | 11/13 **rejected**, 2 processed, quality score **75** |
| 5 | `05_duplicates.csv` | Duplicate detection — exact repeat rows (same Campaign ID+Date+Spend) vs. same Campaign ID with different data | 7/7 processed, 3 flagged (2 exact dupes + 1 ID-only dupe), quality score **79** |
| 6 | `06_reconciliation_and_matching.csv` | AI campaign-name matching (near-miss names, an ambiguous near-duplicate, one with no master-list match) feeding into ad-spend reconciliation | All schema-clean (quality score **100**); reconciliation shows match / review / unmatched-upload / unmatched-platform outcomes |

## Suggested demo order

1. **01** — show a clean run end to end: upload → validation → matching → dashboard, nothing to review.
2. **02** — show the Review UI surfacing auto-corrections (not silent overwrites).
3. **03** — show date handling: 4 formats silently normalized, 2 correctly flagged rather than guessed (see the comment in [dateStandardizer.js](../backend/services/validation/dateStandardizer.js) on why ambiguous dates are never auto-corrected).
4. **04** — show rejected rows are excluded entirely and why, per row, in the Validation Results view.
5. **05** — show duplicate detection distinguishing "exact repeat" from "same ID, different data."
6. **06** — open Reconciliation for this job:
   - `Summer Sale` / `Back to School` → exact match
   - `Q3 Brand Awareness` → variance just under the 5% threshold → match
   - `Holiday Promo` → ~11% variance → review (the brief's own worked example)
   - `Winter Clearance` → large variance → review
   - `Prime Day Push` → uploaded, platform has no record → unmatched (upload side)
   - `New Year Promo` → never uploaded, platform reports spend anyway → unmatched (platform side)
   - `Back to School EMEA Push` and `Totally New Campaign XYZ` show the matcher distinguishing a near-duplicate master name from a genuinely new campaign.

Existing fixtures in `backend/*.csv` (`sample.csv`, `sample_reconciliation.csv`, `sample_low_quality.csv`) are left untouched — they're referenced by `backend/test/uploadRoute.test.js`.
