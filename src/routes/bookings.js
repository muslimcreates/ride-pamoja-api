const express = require('express');
const { requireAuth, requireDriver } = require('../middleware/auth');
const { myBookings, myRides, myEarnings } = require('../controllers/bookingsController');

const router = express.Router();
router.use(requireAuth);

// GET /api/bookings/my          — passenger: my booked rides
router.get('/my', myBookings);

// GET /api/bookings/my/driver   — driver: my posted rides + bookings
router.get('/my/driver', requireDriver, myRides);

// GET /api/bookings/my/earnings — driver: earnings summary
router.get('/my/earnings', requireDriver, myEarnings);

// Placeholders for future booking creation / cancellation
router.post('/', (req, res) => res.status(501).json({ message: 'Booking + M-Pesa coming soon' }));
router.patch('/:id/cancel', (req, res) => res.status(501).json({ message: 'Coming soon' }));

module.exports = router;
