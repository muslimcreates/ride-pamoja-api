const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { sendOtp, verifyOtp, saveProfile, getMe } = require('../controllers/authController');

const router = express.Router();

// Strict rate limiter for OTP endpoints — 5 attempts per 15 minutes per IP
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many OTP requests. Please wait 15 minutes and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public routes
router.post('/send-otp', otpLimiter, sendOtp);
router.post('/verify-otp', otpLimiter, verifyOtp);

// Protected routes (require valid JWT)
router.post('/profile', requireAuth, saveProfile);
router.get('/me', requireAuth, getMe);

module.exports = router;
