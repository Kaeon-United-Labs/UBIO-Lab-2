'use strict';

const config = require('./config');
const distribution = require('./services/distribution');

let timer = null;

async function tick() {
  try {
    const result = await distribution.runOnce();
    if (result.ran || (result.reason && result.reason !== 'not_due' && result.reason !== 'locked')) {
      console.log('[scheduler]', JSON.stringify(result));
    }
  } catch (err) {
    console.error('[scheduler] error:', err.message);
  }
}

function start() {
  if (timer) return;
  console.log(
    `[scheduler] tick=${config.schedulerTickMs}ms interval=${config.distributionIntervalMs}ms network=${config.network}`
  );
  // Tracking is done by comparing system time to the stored last-distribution
  // timestamp on every tick — the tick frequency is just how often we check,
  // independent of the (longer) payout interval.
  timer = setInterval(tick, config.schedulerTickMs);
  timer.unref?.();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick };
