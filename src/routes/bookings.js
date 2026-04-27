const express = require('express');
const { requireAuth, requireDriver } = require('../middleware/auth');
const {
  createBooking, cancelBooking, getBooking, myConversations,
  myBookings, myRides, myEarnings,
} = require('../controllers/bookingsController');

const router = express.Router();
router.use(requireAuth);

// Named sub-routes must come before /:id
router.get('/my/conversations', myConversations);
router.get('/my/driver',        requireDriver, myRides);
router.get('/my/earnings',      requireDriver, myEarnings);
router.get('/my',               myBookings);

// Booking CRUD
router.post('/',            createBooking);
router.get('/:id',          getBooking);
router.patch('/:id/cancel', cancelBooking);

module.exports = router;
