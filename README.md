# UBIO

UBIO is a self-hosted web service that lets a community — a mutual aid group, a library, a credit union, a neighborhood collective — turn donations into a recurring, evenly-split basic income for a group of people it has vetted.

The idea is simple: money comes in from donors, it collects in one pool, and on a regular schedule the whole pool is divided **equally** among everyone currently on the recipient list. No means-testing beyond who's on the list, no favoritism in the split — everyone gets the same share every cycle.

How money comes in, and who's allowed to run their own pool on the same install, are both configurable without touching any code — just environment variables.

---

## The two choices you make when you deploy this

### 1. How donations and payouts move: `PAYMENT_RAIL`

| Value | Currency | How donors give | How recipients get paid |
|---|---|---|---|
| `bitcoin` | BTC | Send Bitcoin to a public wallet address shown on the page | Sent on-chain, directly to each recipient's own address |
| `stripe` | USD | Credit/debit card, processed by Stripe | Deposited via Stripe Connect (bank account or debit card) |
| `paypal` | USD | PayPal checkout | Sent via PayPal Payouts, straight to a PayPal email |

### 2. Who this install serves: `PLATFORM_MODE`

| Value | What it means |
|---|---|
| `single` | This deployment runs **one** basic income program, for one institution. There's one admin password, one recipient list, one pool. |
| `federated` | This deployment is a **shared platform** — anyone can show up and create their own group with its own admin, its own recipients, and its own pool, all running side by side on the same install. |

These two choices are independent, so there are six ways to combine them — for example, one credit union running a single BTC-funded program, or a shared platform where any local nonprofit can spin up its own PayPal-funded group. Whichever combination you pick, the app behaves consistently: the same kind of application/enrollment flow, the same kind of payout schedule, and the same API.

---

## How admission works

- **Single mode**: someone applies with their name, email, and a note (plus a Bitcoin address, if that's the rail). An admin reviews and manually approves them — the idea being a person verifies each applicant's identity before they're added to the pool. This keeps out fake applicants without requiring any automated ID verification.
- **Federated mode**: each group's admin has already agreed to run a program for people they know, so subscribing is instant — no approval queue. An admin can also add someone directly at any time, in either mode.

## How payouts work

- **Bitcoin**: on a fixed interval (7 days by default), the *entire* wallet balance is split, fee-aware, among every current recipient. If splitting would give anyone less than a few hundred satoshis (the minimum a Bitcoin transaction can usefully send), the whole cycle is skipped and the funds simply roll into the next one — no partial, unequal payout is ever sent. Any leftover satoshi that can't split evenly is handed out one at a time, so the biggest possible difference between two recipients in the same cycle is a single satoshi.
- **Stripe / PayPal**: on a short interval (60 seconds by default, since USD balances can be checked continuously rather than read off a blockchain), the app pays out a set dollar amount per recipient — at most half of what the pool can currently afford, so the pool is never drained in one pass and it can keep paying people even if donations slow down. Recipients are paid in rotating order, so nobody is skipped indefinitely.

## Getting paid, per rail

- **Bitcoin**: recipients just give an address when they apply — that's all that's needed, no further setup.
- **Stripe**: after being admitted, a recipient gets an onboarding link to connect a bank account or debit card. They aren't paid until that's finished.
- **PayPal**: a recipient just needs a PayPal email — there's no separate setup step, they're ready to be paid as soon as they're admitted.

---

## Quick start

```bash
npm install
cp .env.example .env      # choose PAYMENT_RAIL and PLATFORM_MODE, fill in the rest
npm test                  # runs the payout-math tests — no database or network needed
npm start
```

You'll need a reachable MongoDB no matter which rail you pick. If you're using Bitcoin, you'll also need a **testnet** wallet — get free test coins from a faucet, and never point this at real funds (mainnet) while you're still evaluating it. If you're using Stripe or PayPal, both start in **mock mode** by default: no account or API keys are needed to try the whole flow — donations confirm instantly and payouts are logged to the console instead of moving real money.

Six example configurations:

```env
# One institution, running on Bitcoin
PAYMENT_RAIL=bitcoin
PLATFORM_MODE=single

# A shared platform where any group can sign up, funded by cards
PAYMENT_RAIL=stripe
PLATFORM_MODE=federated

# One institution, taking card donations
PAYMENT_RAIL=stripe
PLATFORM_MODE=single

# One institution, taking PayPal donations
PAYMENT_RAIL=paypal
PLATFORM_MODE=single

# A shared platform funded by PayPal
PAYMENT_RAIL=paypal
PLATFORM_MODE=federated

# A shared platform running on Bitcoin (each group gets its own wallet, minted automatically)
PAYMENT_RAIL=bitcoin
PLATFORM_MODE=federated
```

`.env.example` documents every variable and which combination it applies to.

Once it's running: the home page is the public donation/application page (or, in federated mode, a directory of groups you can browse or create one of your own). `/admin.html` is the admin dashboard. `/me.html` is where an admitted recipient signs in to check their status and payment history.

---

## Using it as an API, not just a website

Everything the website can do, a script or another program can do too, over plain HTTP — the web pages are just one client of the same API. There are three separate kinds of credentials, so an admin, an admitted recipient, and an anonymous visitor each get exactly the access they should have and no more:

1. **Admin** — manages a group: reviews applications or adds recipients directly, removes people, views payment history, and can trigger a payout cycle immediately instead of waiting for the schedule. Signs in with a password and can act either through a normal browser session or by sending that password (or a token obtained from it) as a bearer token on any request.
2. **Logged-in recipient** — someone already admitted to a pool. The moment they're added, they're given a one-time login password (shown to whoever added them, so it can be passed along). They can sign in to see their own status and payment history, update their payout details, and set their own password.
3. **Anonymous** — anyone else. Can see public information about a group (or the directory of groups, in federated mode), submit an application or subscription, and make a donation. Rate-limited to discourage abuse.

---

## Project layout

```
src/
  config.js          reads PAYMENT_RAIL and PLATFORM_MODE and validates every
                      setting the resulting combination actually needs
  db.js               MongoDB connection and schema
  index.js             starts the server: connects the database, sets up the
                       one institution (single mode) or the group directory
                       (federated mode), and wires up the right routes
  scheduler.js         runs the payout cycle on a timer
  payments/
    stripe.js            card donations + bank/card payouts, via Stripe
    paypal.js             PayPal donations + PayPal payouts
    bitcoin/               wallet signing, chain reads, and wallet generation
  services/
    groups.js              creating and looking up institutions/groups
    recipients.js            applications, enrollment, and payout setup
    recipientAuth.js          recipient login credentials
    donations.js              recording USD donations and pool balances
    distribution-btc.js       the Bitcoin payout engine
    distribution-usd.js       the Stripe/PayPal payout engine
  auth/                 the three credential tiers described above
  routes/               the HTTP API, split by platform mode
public/                the website (one shared set of pages that adapts to
                       whichever rail and mode the server is running)
test/                  automated tests for the payout math and configuration
```

---

## Things to know before you rely on this

- **Mainnet is locked behind an explicit switch.** By default this only talks to Bitcoin's testnet. Pointing it at real Bitcoin (`BTC_NETWORK=mainnet`) requires also setting `I_UNDERSTAND_MAINNET_RISK=yes`, because the wallet's private key is stored in plaintext right next to the public web server — a real deployment needs a better custody story before holding real funds.
- **This hasn't been tested against live payment processors or a live blockchain.** The payout math itself is covered by automated tests and is exact to the last cent or satoshi, but the actual network connections to MongoDB, Bitcoin's network, Stripe, and PayPal haven't been exercised end-to-end in this environment. Test thoroughly in mock/testnet mode, with small amounts, before using real money.
- **This may have legal implications.** Collecting donations and redistributing them to specific people — even with identity checks — can trigger money-transmission, anti-money-laundering, data-privacy, and tax obligations that vary by location, and in federated mode, potentially by every group's own jurisdiction. Talk to a lawyer and an accountant before running this with real money.
