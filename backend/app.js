const express = require('express');
const cors = require('cors');
const logger = require('./middleware/logger.middleware');
const requestLogMiddleware = require('./middleware/requestLog.middleware');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const jobRoutes = require('./routes/job.routes');
const adminRoutes = require('./routes/admin.routes');
const feedbackRoutes = require('./routes/feedback.routes');

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL
    ? [process.env.FRONTEND_URL, 'http://localhost:5173', 'http://localhost:5174']
    : '*',
}));
app.use(express.json());
app.use(logger);
app.use(requestLogMiddleware);

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/feedback', feedbackRoutes);

app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', message: 'Server is running', timestamp: new Date().toISOString() })
);

// Manual trigger for testing — remove before production
app.post('/api/dev/fetch-jobs', async (_req, res) => {
  try {
    const { fetchAdzunaJobs } = require('./services/jobFetcher.service');
    const { matchJobsForAllUsers } = require('./services/jobMatcher.service');
    await fetchAdzunaJobs();
    await matchJobsForAllUsers();
    const Job = require('./models/Job');
    const count = await Job.countDocuments();
    res.json({ message: 'Done', totalJobsInDB: count });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = app;
