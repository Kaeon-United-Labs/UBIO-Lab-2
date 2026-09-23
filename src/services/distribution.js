'use strict';

/**
 * Dispatches to whichever distribution engine matches PAYMENT_RAIL. Both
 * engines expose runCycle() (called by the scheduler on every tick, looping
 * every group) and a way to force one group's payout immediately (the admin
 * "distribute now" action).
 */

const config = require('../config');
const btc = require('./distribution-btc');
const usd = require('./distribution-usd');

async function runCycle() {
  return config.isBitcoin ? btc.runCycle() : usd.runCycle();
}

async function forceRunGroup(group) {
  if (config.isBitcoin) return btc.runOnceForGroup(group, { force: true });
  const result = await usd.runGroupPayout(group);
  return { ran: result.paid > 0, ...result };
}

module.exports = { runCycle, forceRunGroup };
