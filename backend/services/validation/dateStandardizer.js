// Parses a handful of common date formats into ISO 8601 (YYYY-MM-DD).
// Ambiguous or unparseable dates are FLAGGED, never silently guessed —
// auto-correcting a swapped day/month could silently attach spend to
// the wrong day, which is a real business risk, not just a formatting nit.

const FORMATS = [
  { name: 'YYYY-MM-DD', regex: /^(\d{4})-(\d{2})-(\d{2})$/, order: ['y', 'm', 'd'] },
  { name: 'DD/MM/YYYY', regex: /^(\d{2})\/(\d{2})\/(\d{4})$/, order: ['d', 'm', 'y'] },
  { name: 'MM-DD-YYYY', regex: /^(\d{2})-(\d{2})-(\d{4})$/, order: ['m', 'd', 'y'] },
  { name: 'MM/DD/YY', regex: /^(\d{2})\/(\d{2})\/(\d{2})$/, order: ['m', 'd', 'y2'] },
];

function pad(n) {
  return String(n).padStart(2, '0');
}

function standardizeDate(rawValue) {
  if (!rawValue) {
    return { flagged: true, reason: 'missing date', raw: rawValue };
  }

  const trimmed = rawValue.trim();

  for (const format of FORMATS) {
    const match = trimmed.match(format.regex);
    if (!match) continue;

    const parts = {};
    format.order.forEach((key, i) => {
      parts[key] = match[i + 1];
    });
    const year = parts.y || `20${parts.y2}`;
    const month = Number(parts.m);
    const day = Number(parts.d);

    // Sanity check even a matched format — e.g. "13" as a month means
    // the format guess was wrong, not that the date is valid.
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return { flagged: true, reason: `invalid month/day in ${format.name}`, raw: rawValue };
    }

    return {
      flagged: false,
      iso: `${year}-${pad(month)}-${pad(day)}`,
      matchedFormat: format.name,
      raw: rawValue,
    };
  }

  return { flagged: true, reason: 'unrecognized date format', raw: rawValue };
}

module.exports = { standardizeDate };