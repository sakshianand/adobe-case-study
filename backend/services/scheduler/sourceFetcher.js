const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Stubbed per-source pull — the same kind of documented simulation as
// adPlatformPush.js. A real implementation would call each platform's
// reporting API (Meta Marketing API, Google Ads API, Amazon Advertising
// API), write the response to a temp file, and return that path. There are
// no sandbox credentials for any of these here, so this simulates the
// shape of that call instead: a short network-ish delay, then a path to a
// fixture CSV standing in for "the file this source would have produced."
//
// This is intentionally the only faked part of scheduling — everything
// around it (cron registration, run history, notification on failure) is
// real and exercises the actual validation pipeline against this file.
const SOURCE_FIXTURES = {
  Google: 'sample.csv',
  Meta: 'sample.csv',
  Amazon: 'sample_low_quality.csv', // deliberately the low-quality fixture, so a scheduled run can be seen failing/flagging in run history too
};

function simulateNetworkDelay(ms = 250) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSourceFile(source) {
  await simulateNetworkDelay();

  const fixture = SOURCE_FIXTURES[source];
  if (!fixture) {
    throw new Error(`No source fetcher configured for platform "${source}".`);
  }

  // Copied into uploads/ under a throwaway name rather than handing back the
  // fixture's own path — the pipeline unlinks whatever path it's given once
  // processing finishes (same as a real upload's temp file), and the fixture
  // itself needs to survive for the next scheduled run.
  const fixturePath = path.join(__dirname, '..', '..', fixture);
  const filePath = path.join(__dirname, '..', '..', 'uploads', `scheduled-${crypto.randomUUID()}.csv`);
  fs.copyFileSync(fixturePath, filePath);

  return { filePath, originalFileName: `${source.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.csv` };
}

module.exports = { fetchSourceFile };
