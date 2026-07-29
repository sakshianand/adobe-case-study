// Stubbed failure notification — same documented-simulation pattern as
// adPlatformPush.js and sourceFetcher.js. A real implementation would call
// an email provider (SES/SendGrid) or POST to the configured webhook URL.
// This logs what would have been sent instead, so the trigger point and
// payload shape are real even though delivery isn't.
async function notifyFailure(schedule, { error, jobId }) {
  if (!schedule.notify || schedule.notify.method === 'none') return;

  const payload = {
    source: schedule.source,
    scheduleId: schedule.id,
    jobId: jobId || null,
    error,
    failedAt: new Date().toISOString(),
  };

  if (schedule.notify.method === 'email') {
    console.log(`[notifier] would email ${schedule.notify.target || '(no address configured)'}:`, payload);
  } else if (schedule.notify.method === 'webhook') {
    console.log(`[notifier] would POST to ${schedule.notify.target || '(no URL configured)'}:`, payload);
  }
}

module.exports = { notifyFailure };
