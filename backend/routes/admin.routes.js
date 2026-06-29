const express = require('express');
const router = express.Router();
const { isAdmin } = require('../middleware/admin.middleware');
const { listUsers, getUserDetail, runApiForUser } = require('../controllers/admin.controller');

router.use(isAdmin);

router.get('/users', listUsers);
router.get('/users/:id', getUserDetail);
router.post('/users/:id/run-api', runApiForUser);

module.exports = router;
