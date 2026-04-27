const express = require('express');
const { requireAuth, requireDriver } = require('../middleware/auth');
const { createRide, searchRides, getRide, updateRide, getUpcomingRides } = require('../controllers/ridesController');

const router = express.Router();

// All rides routes require authentication
router.use(requireAuth);

// GET /api/rides/search — must come before /:id to avoid param clash
router.get('/search', searchRides);

// GET /api/rides/upcoming — active rides departing in the future
router.get('/upcoming', getUpcomingRides);

// POST /api/rides — driver creates a ride
router.post('/', requireDriver, createRide);

// GET /api/rides/:id — anyone can view a ride
router.get('/:id', getRide);

// PATCH /api/rides/:id — driver updates or cancels
router.patch('/:id', requireDriver, updateRide);

module.exports = router;
