/**
 * gpsSyncWorker.js
 *
 * Background cron worker that manages periodic ingestion of GPS report data
 * from Trans Global Geomatics (TGG) into MongoDB collections.
 *
 * Schedules:
 * 1. Active Daytime Sync (every 15 mins, 6am-9pm IST): Syncs today's live/dynamic report metrics.
 * 2. Nightly Finalization Sync (01:00 AM IST): Finalizes & freezes yesterday's complete 24-hr log.
 */

const cron = require('node-cron');
const { syncAllReportsForDates } = require('../services/gpsSyncService');

/**
 * Get current date string in IST YYYY-MM-DD
 */
const getIstDateString = (offsetDays = 0) => {
  const d = new Date();
  if (offsetDays !== 0) {
    d.setDate(d.getDate() + offsetDays);
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

let isSyncRunning = false;

const runTodaySync = async () => {
  if (isSyncRunning) {
    console.log('[GpsSyncWorker] Sync already in progress, skipping this run.');
    return;
  }
  isSyncRunning = true;
  try {
    const todayStr = getIstDateString(0);
    console.log(`[GpsSyncWorker] Running active daytime sync for today (${todayStr})...`);
    await syncAllReportsForDates([todayStr], true);
  } catch (err) {
    console.error('[GpsSyncWorker] Daytime sync error:', err.message);
  } finally {
    isSyncRunning = false;
  }
};

const runNightlyReconciliation = async () => {
  if (isSyncRunning) return;
  isSyncRunning = true;
  try {
    const yesterdayStr = getIstDateString(-1);
    console.log(`[GpsSyncWorker] Running nightly reconciliation freeze for yesterday (${yesterdayStr})...`);
    await syncAllReportsForDates([yesterdayStr], true);
  } catch (err) {
    console.error('[GpsSyncWorker] Nightly reconciliation error:', err.message);
  } finally {
    isSyncRunning = false;
  }
};

const initGpsSyncWorker = () => {
  console.log('[GpsSyncWorker] Initializing GPS Reports Sync Engine...');

  // 1. Daytime schedule: Every 15 minutes between 6 AM and 9 PM IST
  cron.schedule('*/15 6-21 * * *', runTodaySync, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });

  // 2. Nightly reconciliation: 1:00 AM IST
  cron.schedule('0 1 * * *', runNightlyReconciliation, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });

  console.log('[GpsSyncWorker] Scheduled daytime (15-min) and nightly (01:00 AM) GPS report sync jobs.');

  // Run initial sync on boot asynchronously (after 10s delay to allow DB connection to stabilize)
  setTimeout(() => {
    runTodaySync().catch(e => console.error('[GpsSyncWorker] Boot sync failed:', e.message));
  }, 10000);
};

module.exports = {
  initGpsSyncWorker,
  runTodaySync,
  runNightlyReconciliation
};
