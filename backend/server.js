require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');
const { startFetchJobsCron } = require('./jobs/fetchJobs.job');
const { startDailyEmailCron } = require('./jobs/dailyEmail.job');

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startFetchJobsCron();
    startDailyEmailCron();
  });
});
