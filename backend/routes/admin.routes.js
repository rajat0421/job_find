const express = require('express');
const router = express.Router();
const { isAdmin } = require('../middleware/admin.middleware');
const { listUsers, getUserDetail, runApiForUser, updateEmailSchedule, getEmailScheduleStats, setGlobalEmailSchedule, triggerEmailDigest, getConfig, updateConfig, fixGreenhouseDescriptions, rescoreAllUsers, getLogs, getEmailLogs, getJobBreakdown } = require('../controllers/admin.controller');
const { adminGetFeedback, approveFeedback, declineFeedback, deleteFeedback } = require('../controllers/feedback.controller');

router.use(isAdmin);

router.get('/users', listUsers);
router.get('/users/:id', getUserDetail);
router.post('/users/:id/run-api', runApiForUser);
router.patch('/users/:id/email-schedule', updateEmailSchedule);
router.post('/fix-greenhouse', fixGreenhouseDescriptions);
router.post('/rescore-all', rescoreAllUsers);
router.get('/logs', getLogs);
router.get('/email-logs', getEmailLogs);
router.get('/email-schedule/stats', getEmailScheduleStats);
router.patch('/email-schedule/global', setGlobalEmailSchedule);
router.post('/trigger-digest', triggerEmailDigest);
router.get('/config', getConfig);
router.patch('/config', updateConfig);
router.get('/users/:id/jobs/:jobId/breakdown', getJobBreakdown);

router.get('/feedback',                  adminGetFeedback);
router.patch('/feedback/:id/approve',    approveFeedback);
router.patch('/feedback/:id/decline',    declineFeedback);
router.delete('/feedback/:id',           deleteFeedback);

module.exports = router;
