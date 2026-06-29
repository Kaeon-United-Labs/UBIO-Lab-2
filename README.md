# UBIO

A web service template for an institution to run a grassroots **U**niversal **B**asic **I**ncome program over Bitcoin. Donations accumulate in one wallet; on a fixed interval the entire balance is split evenly among manually-verified recipients.

Node.js + Express + MongoDB, with a build-free vanilla UI.

---

## Quick start

```bash
npm install
cp .env.example .env      # then fill in the blanks
npm test                  # runs the distribution-math tests (no DB/network needed)
npm start
```

Visit the root URL for the public page and `/admin.html` to sign in.

You need a reachable MongoDB and a funded **testnet** wallet to see a real payout. Get testnet coins from a faucet; never start on mainnet while evaluating.

---

## How it works

- **Donations** go to a single wallet whose address is shown publicly.
- **Applicants** submit name, email, BTC address, and an optional note. An admin verifies identity out-of-band and approves them into the payee list (duplicate emails rejected).
- **The admin panel** lives behind a password login. Every action is also reachable as an HTTP request using the admin password as a `Bearer` token.
- **Distribution** runs on an interval. A server-side scheduler compares the current time to the last-distribution timestamp in the database; when a full interval has elapsed, the whole pool is paid out. No timestamp yet → it's seeded on first run and the first payout happens the following cycle. No payees or insufficient funds → no payment.

---

## Implementation Details

**Bitcoin backend.** All chain access (UTXOs, fee rate, broadcast) goes through one swappable module (`src/wallet/esplora.js`) targeting the Esplora REST API (Blockstream by default). Signing happens only in `src/wallet/index.js`. Replace either without touching the rest of the app.

**"All the money, evenly" — reconciled with Bitcoin's actual rules** (`src/services/distribution-math.js`):
- *Fees:* the fee is estimated and subtracted before splitting; "insufficient funds" is fee-aware.
- *Dust:* if each share would fall below the 546-sat dust limit, the cycle is skipped entirely (paying a partial round would violate "equally"). Funds stay on-chain and roll into the next cycle automatically.
- *Remainder:* an amount rarely divides evenly into N integer-satoshi shares. The leftover (always < N sats) is handed out one sat at a time to the first few payees, so the maximum inequality between any two recipients is a single satoshi. Outputs are sized to consume the whole balance minus the fee, so nothing leaks to miners.

**Exactly-once payout** (`src/services/distribution.js`):
- *Single-fire lock:* the scheduler claims the run with one atomic conditional update on a singleton document, so multiple processes/restarts can't double-pay. Stale locks (from a crashed worker) are reclaimed after a timeout.
- *Idempotent cycle record:* a unique index on `cycleId` means a cycle can be recorded — and therefore sent — at most once.
- *Reconciliation:* if a crash lands between broadcast and database write, the next run asks the network whether that cycle's transaction actually went out before doing anything. True exactly-once across two independent systems (Bitcoin + Mongo) is impossible; this is an honest at-most-once with reconciliation, not a guarantee.
- *Skip vs. error:* deliberate skips (no payees / insufficient / sub-dust) advance the clock so retries wait a full interval; transient send errors don't, so they retry promptly.

**Auth.** Password compared in constant time; sessions use httpOnly, sameSite cookies distinct from the long-lived bearer token; login and the public form are rate-limited. The interval values, missing from the original env list, were added.

**Config.** Testnet/mainnet is a single env switch — but mainnet refuses to boot unless you also set `I_UNDERSTAND_MAINNET_RISK=yes` (see below).

---

## ⚠️ Warnings

1. **Hot key on a public box.** The wallet private key sits in plaintext `.env` on the same server that runs the public donation form and admin panel.
2. **Single static admin secret.** One password is both the login and a never-expiring bearer token.
3. **HTTPS is mandatory.** in production (you're sending that token and applicant PII over the wire). Terminate TLS in front of this app and set `NODE_ENV=production` so session cookies are marked secure.
4. **Further testing is pending.** The money-math is unit-tested and conserves to the satoshi, but the Mongo and Esplora integration paths haven't been exercised against a live network here. Test on testnet with small amounts and watch a full cycle before pushing to production.

**Legal:** accepting donations and redistributing money — with manual "identity verification" — can implicate money-transmission, AML/KYC, data-protection (you're storing names + emails), and tax rules that vary by jurisdiction. Consult legal and financial professionals before running with actual funds.

---

## Layout

```
src/
  config.js              env loading + mainnet guard
  db.js                  mongo connection + dynamic bootstrap
  scheduler.js           interval tick
  wallet/
    index.js             facade + the only signing code
    esplora.js           swappable chain backend
  services/
    distribution-math.js pure split logic (unit-tested)
    distribution.js      lock, idempotency, reconciliation, payout
    payees.js            payee/application logic
  routes/
    public.js            info + application endpoints
    admin.js             login, payee CRUD, review, history, bearer API
  middleware/auth.js     constant-time auth + rate limiting
public/                  vanilla HTML/CSS/JS UI
test/                    distribution-math tests
```
