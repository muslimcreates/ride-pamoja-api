const express = require('express');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// Initiate M-Pesa STK push
router.post('/mpesa/stk-push', requireAuth, (req, res) => {
  res.status(501).json({ message: 'Coming soon — M-Pesa STK push' });
});

// M-Pesa callback (called by Safaricom — no auth required)
router.post('/mpesa/callback', (req, res) => {
  console.log('M-Pesa callback received:', JSON.stringify(req.body, null, 2));
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// Check payment status
router.get('/:bookingId/status', requireAuth, (req, res) => {
  res.status(501).json({ message: 'Coming soon — payment status' });
});

module.exports = router;
