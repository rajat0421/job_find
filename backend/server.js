require('dotenv').config();
const { startProcess } = require('./bootstrap');
const { setupGracefulShutdown } = require('./shutdown');

// Default entry point — role is read from PROCESS_ROLE (defaults to "all",
// the existing single-Render-service behavior: API + background schedulers
// in one process). See ./worker.js for the dedicated worker-only entry point.
startProcess()
  .then((ctx) => setupGracefulShutdown(ctx))
  .catch((err) => {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
  });
