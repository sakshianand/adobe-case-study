// Simulated Databricks landing zone — no real workspace/cluster, just two
// separate in-memory tables mirroring the separation the brief asks for:
// raw file records land in one place, cleaned/validated rows in another,
// exactly like a real lakehouse keeps a bronze (raw) and silver (cleaned)
// layer apart rather than overwriting raw data in place.
const rawTable = new Map(); // ingestionKey -> raw file record
const cleanedTable = new Map(); // ingestionKey -> cleaned row array

// Idempotency on file hash + date, per the brief — same concept jobStore's
// checkIdempotency already proves for the upload step, applied here at the
// ingestion boundary so a job that gets approved/retried twice can never
// write the same file's data into Databricks twice.
const ingestedKeys = new Map(); // ingestionKey -> jobId

function ingestionKey(fileHash, uploadDate) {
  return `${fileHash}|${uploadDate}`;
}

function alreadyIngested(key) {
  return ingestedKeys.has(key);
}

function writeRaw(key, record) {
  rawTable.set(key, record);
}

function writeCleaned(key, rows) {
  cleanedTable.set(key, rows);
}

function markIngested(key, jobId) {
  ingestedKeys.set(key, jobId);
}

function getRaw(key) {
  return rawTable.get(key) || null;
}

function getCleaned(key) {
  return cleanedTable.get(key) || null;
}

module.exports = {
  ingestionKey,
  alreadyIngested,
  writeRaw,
  writeCleaned,
  markIngested,
  getRaw,
  getCleaned,
};
