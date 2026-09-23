'use strict';

const config = require('./config');
const distribution = require('./services/distribution');

let timer = null;

async function tick() {
  try {
    const results = await distribution.runCycle();
    const notable = results.filter(
      (r) => r.ran || (r.reason && r.reason !== 'not_due' && r.reason !== 'locked')
    );
    if (notable.length) console.log('[scheduler]', JSON.stringify(notable));
  } catch (err) {
    console.error('[scheduler] error:', err.message);
  }
}

function start() {
  if (timer) return;
  const intervalMs = config.isBitcoin ? config.schedulerTickMs : config.payoutIntervalMs;
  console.log(
    `[scheduler] tick=${intervalMs}ms rail=${config.paymentRail} mode=${config.platformMode}` +
      (config.isBitcoin ? ` cycle=${config.distributionIntervalMs}ms` : '')
  );
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick };
