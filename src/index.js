'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const config = require('./config');
const db = require('./db');
const scheduler = require('./scheduler');
const groupsService = require('./services/groups');

const webhookRoutes = require('./routes/webhook');
const meRoutes = require('./routes/me');

async function main() {
  await db.connect();
  if (config.isSingle) await groupsService.ensureSingletonGroup();

  const app = express();
  app.set('trust proxy', 1);

  // Stripe/PayPal webhooks need the raw body for signature verification, so
  // they're mounted before any JSON body parser touches the request.
  if (config.isUsd) app.use(webhookRoutes);

  // Tiny, mode-agnostic bootstrap endpoint so the static UI (served from the
  // same public/ folder regardless of mode) knows, without guessing, which
  // markup to render. Not present in either source app — purely additive.
  app.get('/api/mode', (req, res) => {
    res.json({ platformMode: config.platformMode, paymentRail: config.paymentRail, currency: config.currency });
  });

  if (config.isSingle) {
    // Browser admin sessions only exist in single mode — federated-mode
    // admins authenticate with a bearer JWT the client stores itself,
    // exactly as in Lab/2.
    app.use(
      session({
        secret: config.sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: {
          httpOnly: true,
          sameSite: 'strict',
          secure: process.env.NODE_ENV === 'production',
          maxAge: 8 * 60 * 60 * 1000,
        },
      })
    );

    app.use(require('./routes/publicSingle'));
    app.use('/admin/api', require('./routes/adminSingle'));
    app.use('/api/me', meRoutes);
  } else {
    app.use(require('./routes/publicFederated'));
    app.use('/api/admin', require('./routes/adminFederated'));
    app.use('/api/groups/:slug/me', meRoutes);
  }

  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[server]', err);
    res.status(status).json({ error: err.message || 'Something went wrong.' });
  });

  app.listen(config.port, () => {
    console.log(
      `UBIO (Neo) listening on :${config.port}  rail=${config.paymentRail}  mode=${config.platformMode}` +
        (config.isSingle ? `  ${config.institutionName}` : '')
    );
    scheduler.start();
  });

  return app;
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal startup error:', err.message);
    process.exit(1);
  });
}

module.exports = { main };
