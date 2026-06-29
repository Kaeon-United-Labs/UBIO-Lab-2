'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const config = require('./config');
const db = require('./db');
const scheduler = require('./scheduler');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

async function main() {
  await db.connect();

  const app = express();
  app.set('trust proxy', 1); // correct req.ip behind a reverse proxy

  app.use(
    session({
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'strict',
        // Set secure cookies in production; requires HTTPS termination.
        secure: process.env.NODE_ENV === 'production',
        maxAge: 8 * 60 * 60 * 1000,
      },
    })
  );

  app.use('/', publicRoutes);
  app.use('/admin/api', adminRoutes);
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.listen(config.port, () => {
    console.log(`UBIO listening on :${config.port}  [${config.network}]  ${config.institutionName}`);
    scheduler.start();
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err.message);
  process.exit(1);
});
