const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { submitVerification, getVerificationStatus } = require('../controllers/driverController');

const router = express.Router();
router.use(requireAuth);

router.get('/verify',  getVerificationStatus);   // GET  /api/driver/verify
router.post('/verify', submitVerification);       // POST /api/driver/verify

module.exports = router;
