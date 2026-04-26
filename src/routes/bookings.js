const express = require('express');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.post('/', requireAuth, (req, res) => {
  res.status(501).json({ message: 'Coming soon — create booking' });
});

router.get('/my', requireAuth, (req, res) => {
  res.status(501).json({ message: 'Coming soon — my bookings' });
});

router.get('/:id', requireAuth, (req, res) => {
  res.status(501).json({ message: 'Coming soon — get booking' });
});

router.patch('/:id/cancel', requireAuth, (req, res) => {
  res.status(501).json({ message: 'Coming soon — cancel booking' });
});

module.exports = router;
