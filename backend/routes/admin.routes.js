const express = require('express');
const router = express.Router();
const { isAdmin } = require('../middleware/admin.middleware');
const { listUsers, getUserDetail, runApiForUser, updateEmailSchedule, fixGreenhouseDescriptions, rescoreAllUsers, getLogs } = require('../controllers/admin.controller');
const { adminGetFeedback, deleteFeedback, deleteReply } = require('../controllers/feedback.controller');

router.use(isAdmin);

router.get('/users', listUsers);
router.get('/users/:id', getUserDetail);
router.post('/users/:id/run-api', runApiForUser);
router.patch('/users/:id/email-schedule', updateEmailSchedule);
router.post('/fix-greenhouse', fixGreenhouseDescriptions);
router.post('/rescore-all', rescoreAllUsers);
router.get('/logs', getLogs);

router.get('/feedback', adminGetFeedback);
router.delete('/feedback/:id', deleteFeedback);
router.delete('/feedback/:id/reply/:replyId', deleteReply);

module.exports = router;
