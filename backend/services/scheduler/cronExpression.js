// Turns a schedule's plain-language config into a cron expression node-cron
// understands. Kept separate from schedulerEngine.js so the mapping is unit
// -testable without touching any actual cron registration.
function toCronExpression({ frequency, time, dayOfWeek }) {
  const [hour, minute] = (time || '07:00').split(':').map(Number);

  switch (frequency) {
    case 'hourly':
      return `${minute} * * * *`; // fire at the same minute of every hour
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekly':
      return `${minute} ${hour} * * ${dayOfWeek ?? 1}`;
    case 'manual':
      return null; // never auto-fires — only triggered via POST /schedules/:id/trigger
    default:
      throw new Error(`Unknown frequency: ${frequency}`);
  }
}

module.exports = { toCronExpression };
