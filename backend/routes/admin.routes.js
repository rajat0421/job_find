const express = require('express');
const router = express.Router();
const { isAdmin } = require('../middleware/admin.middleware');
const { listUsers, getUserDetail, runApiForUser, updateEmailSchedule, getEmailScheduleStats, setGlobalEmailSchedule, triggerEmailDigest, getConfig, updateConfig, fixGreenhouseDescriptions, rescoreAllUsers, backfillMatches, getLogs, getEmailLogs, getJobBreakdown, sendDigestForUser, getUpcomingEmails, listCompanies, createCompany, updateCompany, deleteCompany, getJobs, getAnalytics } = require('../controllers/admin.controller');
const { adminGetFeedback, approveFeedback, declineFeedback, deleteFeedback } = require('../controllers/feedback.controller');

router.use(isAdmin);

router.get('/users', listUsers);
router.get('/users/:id', getUserDetail);
router.post('/users/:id/run-api', runApiForUser);
router.post('/users/:id/send-digest', sendDigestForUser);
router.patch('/users/:id/email-schedule', updateEmailSchedule);
router.post('/fix-greenhouse', fixGreenhouseDescriptions);
router.post('/rescore-all', rescoreAllUsers);
router.post('/backfill-matches', backfillMatches);
router.get('/logs', getLogs);
router.get('/email-logs', getEmailLogs);
router.get('/email-schedule/stats', getEmailScheduleStats);
router.get('/email-schedule/upcoming', getUpcomingEmails);
router.patch('/email-schedule/global', setGlobalEmailSchedule);
router.post('/trigger-digest', triggerEmailDigest);
router.get('/config', getConfig);
router.patch('/config', updateConfig);
router.get('/jobs', getJobs);
router.get('/analytics', getAnalytics);
router.get('/companies', listCompanies);
router.post('/companies', createCompany);
router.patch('/companies/:id', updateCompany);
router.delete('/companies/:id', deleteCompany);
router.get('/users/:id/jobs/:jobId/breakdown', getJobBreakdown);

router.get('/feedback',                  adminGetFeedback);
router.patch('/feedback/:id/approve',    approveFeedback);
router.patch('/feedback/:id/decline',    declineFeedback);
router.delete('/feedback/:id',           deleteFeedback);

module.exports = router;
