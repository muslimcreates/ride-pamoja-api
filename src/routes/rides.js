const express = require('express');
const { requireAuth, requireDriver } = require('../middleware/auth');
const { createRide, searchRides, getRide, updateRide } = require('../controllers/ridesController');

const router = express.Router();

// All rides routes require authentication
router.use(requireAuth);

// GET /api/rides/search — must come before /:id so GoRouter doesn't eat "search"
router.get('/search', searchRides);

// POST /api/rides — driver creates a ride
router.post('/', requireDriver, createRide);

// GET /api/rides/:id — anyone can view a ride
router.get('/:id', getRide);

// PATCH /api/rides/:id — driver updates or cancels
router.patch('/:id', requireDriver, updateRide);

module.exports = router;
