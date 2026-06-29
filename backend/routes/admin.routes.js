const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { isAdmin } = require('../middleware/admin.middleware');
const { listUsers, getUserDetail, runApiForUser } = require('../controllers/admin.controller');

router.use(protect, isAdmin);

router.get('/users', listUsers);
router.get('/users/:id', getUserDetail);
router.post('/users/:id/run-api', runApiForUser);

module.exports = router;
