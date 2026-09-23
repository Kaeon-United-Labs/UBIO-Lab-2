'use strict';

/**
 * Pure functions for planning a payout. No I/O, no network, no DB — so this
 * can be unit-tested in isolation. This is where the "all the money, evenly"
 * claim from the spec is reconciled with what Bitcoin actually permits.
 *
 * Model: the service distributes the ENTIRE spendable balance each cycle, so
 * coin selection is trivial — every confirmed UTXO becomes an input. Because
 * inputs - outputs = fee on Bitcoin, we size the outputs to consume the whole
 * balance minus the estimated fee. There is therefore no change output and no
 * "lost to fee" remainder.
 */

const DUST_THRESHOLD_SATS = 546; // standard dust limit for P2WPKH-ish outputs

// Rough vbyte weights. We assume native segwit (P2WPKH) for inputs and outputs.
const VB_PER_INPUT = 68;
const VB_PER_OUTPUT = 31;
const VB_OVERHEAD = 11;

function estimateFeeSats({ inputCount, outputCount, feeRateSatPerVByte }) {
  const vbytes = inputCount * VB_PER_INPUT + outputCount * VB_PER_OUTPUT + VB_OVERHEAD;
  return Math.ceil(vbytes * feeRateSatPerVByte);
}

/**
 * @returns {{
 *   ok: boolean,
 *   reason?: 'no_payees'|'insufficient_funds'|'sub_dust',
 *   feeSats?: number,
 *   distributableSats?: number,
 *   baseShareSats?: number,
 *   remainderSats?: number,
 *   shares?: number[]   // one integer-sat amount per payee, same order in
 * }}
 *
 * Remainder rule: an arbitrary amount rarely divides evenly into N integer
 * shares. The leftover (always < N sats) is handed out one sat at a time to the
 * first `remainder` payees. Maximum inequality between any two payees is thus a
 * single satoshi — defensibly "equal."
 */
function planDistribution({
  totalSats,
  payeeCount,
  inputCount,
  feeRateSatPerVByte,
  dustThreshold = DUST_THRESHOLD_SATS,
}) {
  if (payeeCount <= 0) return { ok: false, reason: 'no_payees' };

  const feeSats = estimateFeeSats({
    inputCount,
    outputCount: payeeCount,
    feeRateSatPerVByte,
  });

  const distributableSats = totalSats - feeSats;
  if (distributableSats <= 0) {
    return { ok: false, reason: 'insufficient_funds', feeSats };
  }

  const baseShareSats = Math.floor(distributableSats / payeeCount);

  // If we can't give everyone at least a dust-spendable amount, we don't pay a
  // partial round — the spec says "equally among ALL payees." We skip; the
  // funds stay on-chain and roll into the next cycle automatically.
  if (baseShareSats < dustThreshold) {
    return { ok: false, reason: 'sub_dust', feeSats, distributableSats, baseShareSats };
  }

  const remainderSats = distributableSats - baseShareSats * payeeCount;
  const shares = [];
  for (let i = 0; i < payeeCount; i++) {
    shares.push(baseShareSats + (i < remainderSats ? 1 : 0));
  }

  return {
    ok: true,
    feeSats,
    distributableSats,
    baseShareSats,
    remainderSats,
    shares,
  };
}

module.exports = {
  DUST_THRESHOLD_SATS,
  estimateFeeSats,
  planDistribution,
};
