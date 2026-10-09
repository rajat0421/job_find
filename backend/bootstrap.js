const connectDB = require('./config/db');
const { getProcessRole } = require('./config/processRole');

// Starts this process according to its role. Shared by server.js (the
// existing Render entry point — role defaults to "all", i.e. API + schedulers
// in one process, unchanged) and worker.js (a dedicated worker-only entry
// point for when the API and background jobs are eventually split into
// separate services/processes).
//
// Requires for './app' and './jobs/scheduler' are deliberately INSIDE the
// role branches (not at module top-level) so an "api"-role process never
// touches the scheduler module and a "worker"-role process never builds or
// binds the Express app.
const startProcess = async (roleOverride) => {
  const role = roleOverride || getProcessRole();
  console.log(`[Bootstrap] Starting process in "${role}" mode`);

  await connectDB();

  let httpServer = null;
  if (role === 'all' || role === 'api') {
    const app = require('./app');
    const PORT = process.env.PORT || 5000;
    httpServer = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  }

  let schedulerHandle = null;
  if (role === 'all' || role === 'worker') {
    const { startSchedulers } = require('./jobs/scheduler');
    schedulerHandle = startSchedulers();
  }

  return { role, httpServer, schedulerHandle };
};

module.exports = { startProcess };
