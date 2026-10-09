require('dotenv').config();
const { startProcess } = require('./bootstrap');
const { setupGracefulShutdown } = require('./shutdown');

// Dedicated worker entry point — always runs in "worker" role (background
// schedulers + MongoDB connection only, no HTTP API), regardless of
// PROCESS_ROLE, so `node worker.js` is unambiguous once the API and worker
// are split into separate services/processes. Not used by the current
// single-Render-service deployment (server.js in "all" mode covers that) —
// this exists so that split is a config change later, not a code change.
startProcess('worker')
  .then((ctx) => setupGracefulShutdown(ctx))
  .catch((err) => {
    console.error('[Worker] Failed to start:', err);
    process.exit(1);
  });
