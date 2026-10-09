const mongoose = require('mongoose');

const GRACE_MS = 10_000; // max time to wait for an in-flight cron run to finish
const POLL_MS = 250;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitUntilIdle = async (isBusy, timeoutMs) => {
  if (typeof isBusy !== 'function') return;
  const deadline = Date.now() + timeoutMs;
  while (isBusy() && Date.now() < deadline) {
    await sleep(POLL_MS);
  }
  if (isBusy()) {
    console.warn('[Shutdown] Grace period elapsed with a cron run still in progress — closing DB connection anyway');
  }
};

// Stops accepting new work, lets in-flight work finish (bounded by a grace
// period), then closes the shared MongoDB connection. Safe to call multiple
// times (a second signal while already shutting down is ignored) so we never
// double-close shared resources out from under active work.
const setupGracefulShutdown = ({ httpServer, schedulerHandle } = {}) => {
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Shutdown] ${signal} received — shutting down gracefully`);

    // Stop scheduling new cron ticks immediately — does not interrupt a tick
    // already in progress.
    schedulerHandle?.stopAll?.();

    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve)); // stop new connections, let in-flight requests finish
    }

    await waitUntilIdle(schedulerHandle?.isBusy, GRACE_MS);

    try {
      await mongoose.connection.close(false);
      console.log('[Shutdown] MongoDB connection closed.');
    } catch (err) {
      console.error('[Shutdown] Error closing MongoDB connection:', err.message);
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return shutdown;
};

module.exports = { setupGracefulShutdown };
